import { createToneWav } from './wav'

export interface TtsRequest {
  text: string
  voice: string
  format: 'wav'
}

export interface TtsProvider {
  readonly name: string
  synthesize(request: TtsRequest): Promise<Buffer>
}

export function createFakeProvider(): TtsProvider {
  return {
    name: 'fake',
    async synthesize(request) {
      const duration = Math.min(Math.max(request.text.length * 6, 80), 2000)
      const hash = [...request.voice].reduce((sum, char) => sum + char.charCodeAt(0), 0)
      return createToneWav(duration, 16000, 320 + (hash % 200))
    },
  }
}

export interface HttpProviderOptions {
  url: string
  token?: string
  timeoutMs?: number
  maxAttempts?: number
  retryBaseDelayMs?: number
  maxRetryDelayMs?: number
}

interface HttpTtsResponse {
  audioBase64?: string
  audio_base64?: string
  data?: string
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
  }
  return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
}

export class HttpTtsProvider implements TtsProvider {
  readonly name = 'http'

  constructor(private readonly options: HttpProviderOptions) {}

  async synthesize(request: TtsRequest): Promise<Buffer> {
    const maxAttempts = this.options.maxAttempts ?? 4
    const baseDelay = this.options.retryBaseDelayMs ?? 500
    const maxDelay = this.options.maxRetryDelayMs ?? 8000
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000)

      try {
        const response = await fetch(this.options.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        })

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          lastError = new Error(`TTS 服务返回 ${response.status}: ${body.slice(0, 200)}`)
          if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
            await sleep(
              retryDelayMs(attempt, baseDelay, maxDelay, response.headers.get('retry-after')),
            )
            continue
          }
          throw lastError
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          const payload = (await response.json()) as HttpTtsResponse
          const encoded = payload.audioBase64 ?? payload.audio_base64 ?? payload.data
          if (!encoded) throw new Error('TTS 服务未返回音频数据')
          return Buffer.from(encoded, 'base64')
        }

        return Buffer.from(await response.arrayBuffer())
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

    throw lastError ?? new Error('TTS 调用失败')
  }
}

export function createProviderFromEnv(env: NodeJS.ProcessEnv): TtsProvider {
  if (env.TTS_PROVIDER === 'http' && env.TTS_HTTP_URL) {
    return new HttpTtsProvider({
      url: env.TTS_HTTP_URL,
      token: env.TTS_HTTP_TOKEN,
      timeoutMs: Number(env.TTS_HTTP_TIMEOUT_MS ?? 60_000),
      maxAttempts: Number(env.TTS_MAX_ATTEMPTS ?? 4),
      retryBaseDelayMs: Number(env.TTS_RETRY_BASE_MS ?? 500),
    })
  }
  return createFakeProvider()
}
