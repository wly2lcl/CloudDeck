import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { DashScopeTtsProvider, HttpTtsProvider } from '../src/providers'
import { createToneWav, parseWav } from '../src/wav'

const servers: Server[] = []

function startServer(
  handler: (body: string) => { status: number; contentType: string; payload: Buffer | string },
): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        const result = handler(body)
        response.writeHead(result.status, { 'content-type': result.contentType })
        response.end(result.payload)
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) resolve(address.port)
      else resolve(0)
    })
  })
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

describe('HTTP TTS provider', () => {
  it('429 后自动重试并成功', async () => {
    const wav = createToneWav(50)
    let calls = 0
    const port = await startServer(() => {
      calls += 1
      if (calls === 1) {
        return { status: 429, contentType: 'application/json', payload: '{"error":"rate"}' }
      }
      return { status: 200, contentType: 'audio/wav', payload: wav }
    })
    const provider = new HttpTtsProvider({
      url: `http://127.0.0.1:${port}/tts`,
      retryBaseDelayMs: 1,
    })
    const data = await provider.synthesize({ text: '你好', voice: 'v1', format: 'wav' })
    expect(parseWav(data).sampleRate).toBe(16000)
    expect(calls).toBe(2)
  })

  it('接收二进制音频响应', async () => {
    const wav = createToneWav(50)
    const port = await startServer(() => ({
      status: 200,
      contentType: 'audio/wav',
      payload: wav,
    }))
    const provider = new HttpTtsProvider({ url: `http://127.0.0.1:${port}/tts` })
    const data = await provider.synthesize({ text: '你好', voice: 'v1', format: 'wav' })
    expect(parseWav(data).sampleRate).toBe(16000)
  })

  it('接收 JSON base64 响应', async () => {
    const wav = createToneWav(50)
    const port = await startServer((body) => ({
      status: 200,
      contentType: 'application/json',
      payload: JSON.stringify({ audioBase64: wav.toString('base64'), echo: body }),
    }))
    const provider = new HttpTtsProvider({ url: `http://127.0.0.1:${port}/tts` })
    const data = await provider.synthesize({ text: '你好', voice: 'v1', format: 'wav' })
    expect(parseWav(data).sampleRate).toBe(16000)
  })

  it('非 2xx 响应抛错', async () => {
    const port = await startServer(() => ({
      status: 500,
      contentType: 'application/json',
      payload: '{}',
    }))
    const provider = new HttpTtsProvider({
      url: `http://127.0.0.1:${port}/tts`,
      maxAttempts: 1,
    })
    await expect(
      provider.synthesize({ text: '你好', voice: 'v1', format: 'wav' }),
    ).rejects.toThrow('500')
  })
})

describe('DashScope TTS provider', () => {
  it('解析 base64 音频并把占位音色替换为默认音色', async () => {
    const wav = createToneWav(50)
    let received = ''
    const port = await startServer((body) => {
      received = body
      return {
        status: 200,
        contentType: 'application/json',
        payload: JSON.stringify({ output: { audio: { data: wav.toString('base64') } } }),
      }
    })
    const provider = new DashScopeTtsProvider({
      token: 'test',
      endpoint: `http://127.0.0.1:${port}/tts`,
      defaultVoice: 'longanhuan_v3.1',
    })
    const data = await provider.synthesize({ text: '你好', voice: 'narrator', format: 'wav' })
    expect(parseWav(data).sampleRate).toBe(16000)
    const payload = JSON.parse(received) as {
      model: string
      input: { voice: string; format: string }
    }
    expect(payload.model).toBe('qwen-audio-3.1-tts-flash')
    expect(payload.input.voice).toBe('longanhuan_v3.1')
    expect(payload.input.format).toBe('wav')
  })

  it('下载 output.audio.url 指向的音频', async () => {
    const wav = createToneWav(50)
    let port = 0
    port = await startServer((body) => {
      if (body.includes('"text"')) {
        return {
          status: 200,
          contentType: 'application/json',
          payload: JSON.stringify({
            output: { audio: { url: `http://127.0.0.1:${port}/audio.wav` } },
          }),
        }
      }
      return { status: 200, contentType: 'audio/wav', payload: wav }
    })
    const provider = new DashScopeTtsProvider({
      token: 'test',
      endpoint: `http://127.0.0.1:${port}/tts`,
    })
    const data = await provider.synthesize({ text: '你好', voice: 'longanhuan_v3.1', format: 'wav' })
    expect(parseWav(data).sampleRate).toBe(16000)
  })

  it('429 后重试成功', async () => {
    const wav = createToneWav(50)
    let calls = 0
    const port = await startServer(() => {
      calls += 1
      if (calls === 1) return { status: 429, contentType: 'application/json', payload: '{}' }
      return {
        status: 200,
        contentType: 'application/json',
        payload: JSON.stringify({ output: { audio: { data: wav.toString('base64') } } }),
      }
    })
    const provider = new DashScopeTtsProvider({
      token: 'test',
      endpoint: `http://127.0.0.1:${port}/tts`,
      retryBaseDelayMs: 1,
    })
    const data = await provider.synthesize({ text: '你好', voice: 'longanhuan_v3.1', format: 'wav' })
    expect(parseWav(data).sampleRate).toBe(16000)
    expect(calls).toBe(2)
  })
})
