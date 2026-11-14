export interface LlmRequest {
  system: string
  prompt: string
  json?: boolean
}

export interface LlmResult {
  text: string
  costUsd: number
  inputTokens?: number
  outputTokens?: number
}

export interface LlmProvider {
  readonly name: string
  complete(request: LlmRequest): Promise<LlmResult>
}

export interface HttpLlmOptions {
  baseUrl: string
  model: string
  token?: string
  pricePer1kTokensUsd?: number
  timeoutMs?: number
  maxAttempts?: number
  retryBaseDelayMs?: number
  maxRetryDelayMs?: number
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

function retryDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  retryAfterHeader: string | null,
): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, maxDelayMs)
    }
    const date = Date.parse(retryAfterHeader)
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0), maxDelayMs)
    }
  }
  return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
}

/** OpenAI 兼容的 chat/completions 客户端，遇到 429/5xx 自动指数退避重试。 */
export class HttpLlmProvider implements LlmProvider {
  readonly name = 'http'

  constructor(private readonly options: HttpLlmOptions) {}

  async complete(request: LlmRequest): Promise<LlmResult> {
    const maxAttempts = this.options.maxAttempts ?? 4
    const baseDelay = this.options.retryBaseDelayMs ?? 500
    const maxDelay = this.options.maxRetryDelayMs ?? 8000
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120_000)

      try {
        const response = await fetch(
          `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
            },
            body: JSON.stringify({
              model: this.options.model,
              messages: [
                { role: 'system', content: request.system },
                { role: 'user', content: request.prompt },
              ],
              ...(request.json ? { response_format: { type: 'json_object' } } : {}),
            }),
            signal: controller.signal,
          },
        )

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          lastError = new Error(
            `LLM 服务返回 ${response.status}: ${body.slice(0, 300)}`,
          )
          if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
            await sleep(
              retryDelayMs(attempt, baseDelay, maxDelay, response.headers.get('retry-after')),
            )
            continue
          }
          throw lastError
        }

        const payload = (await response.json()) as ChatCompletionResponse
        const text = payload.choices?.[0]?.message?.content
        if (!text) throw new Error('LLM 未返回内容')

        const inputTokens = payload.usage?.prompt_tokens ?? 0
        const outputTokens = payload.usage?.completion_tokens ?? 0
        const price = this.options.pricePer1kTokensUsd ?? 0.002
        const costUsd = Number((((inputTokens + outputTokens) / 1000) * price).toFixed(6))

        return { text, costUsd, inputTokens, outputTokens }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        const isAbort = lastError.name === 'AbortError'
        const isNetwork = lastError instanceof TypeError
        if (attempt < maxAttempts && (isAbort || isNetwork)) {
          await sleep(retryDelayMs(attempt, baseDelay, maxDelay, null))
          continue
        }
        throw lastError
      } finally {
        clearTimeout(timer)
      }
    }

    throw lastError ?? new Error('LLM 调用失败')
  }
}

export function createLlmProviderFromEnv(env: NodeJS.ProcessEnv): LlmProvider | undefined {
  if (!env.LLM_HTTP_URL || !env.LLM_MODEL) return undefined
  return new HttpLlmProvider({
    baseUrl: env.LLM_HTTP_URL,
    model: env.LLM_MODEL,
    token: env.LLM_HTTP_TOKEN,
    pricePer1kTokensUsd: Number(env.LLM_PRICE_PER_1K_TOKENS ?? 0.002),
    maxAttempts: Number(env.LLM_MAX_ATTEMPTS ?? 4),
    retryBaseDelayMs: Number(env.LLM_RETRY_BASE_MS ?? 500),
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 120_000),
  })
}
