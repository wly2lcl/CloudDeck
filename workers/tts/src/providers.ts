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

export interface DashScopeProviderOptions {
  token: string
  model?: string
  endpoint?: string
  defaultVoice?: string
  timeoutMs?: number
  maxAttempts?: number
  retryBaseDelayMs?: number
  maxRetryDelayMs?: number
}

interface DashScopeResponse {
  output?: {
    audio?: { url?: string; data?: string }
  }
  usage?: { characters?: number }
  code?: string
  message?: string
}

const DASHSCOPE_DEFAULT_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer'
const DASHSCOPE_DEFAULT_VOICE = 'longanhuan_v3.1'
const PLACEHOLDER_VOICES = new Set(['', 'narrator', 'default', '对白', '旁白'])

/** 阿里云百炼 qwen-audio TTS。 */
export class DashScopeTtsProvider implements TtsProvider {
  readonly name = 'dashscope'

  constructor(private readonly options: DashScopeProviderOptions) {}

  private resolveVoice(voice: string): string {
    const fallback = this.options.defaultVoice ?? DASHSCOPE_DEFAULT_VOICE
    return PLACEHOLDER_VOICES.has(voice) ? fallback : voice
  }

  async synthesize(request: TtsRequest): Promise<Buffer> {
    const maxAttempts = this.options.maxAttempts ?? 4
    const baseDelay = this.options.retryBaseDelayMs ?? 500
    const maxDelay = this.options.maxRetryDelayMs ?? 8000
    const endpoint = this.options.endpoint ?? DASHSCOPE_DEFAULT_ENDPOINT
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 90_000)

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.options.token}`,
          },
          body: JSON.stringify({
            model: this.options.model ?? 'qwen-audio-3.1-tts-flash',
            input: {
              text: request.text,
              voice: this.resolveVoice(request.voice),
              format: 'wav',
              sample_rate: 24000,
            },
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          lastError = new Error(`DashScope TTS 返回 ${response.status}: ${body.slice(0, 300)}`)
          if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
            await sleep(
              retryDelayMs(attempt, baseDelay, maxDelay, response.headers.get('retry-after')),
            )
            continue
          }
          throw lastError
        }

        const payload = (await response.json()) as DashScopeResponse
        if (payload.code) {
          throw new Error(`DashScope TTS 错误 ${payload.code}: ${payload.message ?? ''}`)
        }

        const audio = payload.output?.audio
        if (audio?.data) return Buffer.from(audio.data, 'base64')
        if (audio?.url) {
          const download = await fetch(audio.url)
          if (!download.ok) throw new Error(`音频下载失败 ${download.status}`)
          return Buffer.from(await download.arrayBuffer())
        }
        throw new Error('DashScope 未返回音频数据')
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

    throw lastError ?? new Error('DashScope TTS 调用失败')
  }
}

export function createProviderFromEnv(env: NodeJS.ProcessEnv): TtsProvider {
  if (
    (env.TTS_PROVIDER === 'dashscope' || env.TTS_PROVIDER === 'bailian') &&
    (env.DASHSCOPE_API_KEY || env.BAILIAN_API_KEY)
  ) {
    return new DashScopeTtsProvider({
      token: (env.DASHSCOPE_API_KEY ?? env.BAILIAN_API_KEY) as string,
      model: env.TTS_MODEL ?? 'qwen-audio-3.1-tts-flash',
      endpoint: env.TTS_DASHSCOPE_URL,
      defaultVoice: env.TTS_DEFAULT_VOICE ?? DASHSCOPE_DEFAULT_VOICE,
      maxAttempts: Number(env.TTS_MAX_ATTEMPTS ?? 4),
      retryBaseDelayMs: Number(env.TTS_RETRY_BASE_MS ?? 500),
      maxRetryDelayMs: Number(env.TTS_RETRY_MAX_MS ?? 8000),
    })
  }
  if (env.TTS_PROVIDER === 'http' && env.TTS_HTTP_URL) {
    return new HttpTtsProvider({
      url: env.TTS_HTTP_URL,
      token: env.TTS_HTTP_TOKEN,
      timeoutMs: Number(env.TTS_HTTP_TIMEOUT_MS ?? 60_000),
      maxAttempts: Number(env.TTS_MAX_ATTEMPTS ?? 4),
      retryBaseDelayMs: Number(env.TTS_RETRY_BASE_MS ?? 500),
      maxRetryDelayMs: Number(env.TTS_RETRY_MAX_MS ?? 8000),
    })
  }
  return createFakeProvider()
}
