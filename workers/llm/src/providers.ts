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
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** OpenAI 兼容的 chat/completions 客户端。 */
export class HttpLlmProvider implements LlmProvider {
  readonly name = 'http'

  constructor(private readonly options: HttpLlmOptions) {}

  async complete(request: LlmRequest): Promise<LlmResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120_000)

    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
      })

      if (!response.ok) throw new Error(`LLM 服务返回 ${response.status}`)

      const payload = (await response.json()) as ChatCompletionResponse
      const text = payload.choices?.[0]?.message?.content
      if (!text) throw new Error('LLM 未返回内容')

      const inputTokens = payload.usage?.prompt_tokens ?? 0
      const outputTokens = payload.usage?.completion_tokens ?? 0
      const price = this.options.pricePer1kTokensUsd ?? 0.002
      const costUsd = Number((((inputTokens + outputTokens) / 1000) * price).toFixed(6))

      return { text, costUsd, inputTokens, outputTokens }
    } finally {
      clearTimeout(timer)
    }
  }
}

export function createLlmProviderFromEnv(env: NodeJS.ProcessEnv): LlmProvider | undefined {
  if (!env.LLM_HTTP_URL || !env.LLM_MODEL) return undefined
  return new HttpLlmProvider({
    baseUrl: env.LLM_HTTP_URL,
    model: env.LLM_MODEL,
    token: env.LLM_HTTP_TOKEN,
    pricePer1kTokensUsd: Number(env.LLM_PRICE_PER_1K_TOKENS ?? 0.002),
  })
}
