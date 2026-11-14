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
}

interface HttpTtsResponse {
  audioBase64?: string
  audio_base64?: string
  data?: string
}

export class HttpTtsProvider implements TtsProvider {
  readonly name = 'http'

  constructor(private readonly options: HttpProviderOptions) {}

  async synthesize(request: TtsRequest): Promise<Buffer> {
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
        throw new Error(`TTS 服务返回 ${response.status}`)
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as HttpTtsResponse
        const encoded = payload.audioBase64 ?? payload.audio_base64 ?? payload.data
        if (!encoded) throw new Error('TTS 服务未返回音频数据')
        return Buffer.from(encoded, 'base64')
      }

      return Buffer.from(await response.arrayBuffer())
    } finally {
      clearTimeout(timer)
    }
  }
}

export function createProviderFromEnv(env: NodeJS.ProcessEnv): TtsProvider {
  if (env.TTS_PROVIDER === 'http' && env.TTS_HTTP_URL) {
    return new HttpTtsProvider({
      url: env.TTS_HTTP_URL,
      token: env.TTS_HTTP_TOKEN,
      timeoutMs: Number(env.TTS_HTTP_TIMEOUT_MS ?? 60_000),
    })
  }
  return createFakeProvider()
}
