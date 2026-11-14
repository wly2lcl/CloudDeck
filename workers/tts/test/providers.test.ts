import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { HttpTtsProvider } from '../src/providers'
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
    const provider = new HttpTtsProvider({ url: `http://127.0.0.1:${port}/tts` })
    await expect(
      provider.synthesize({ text: '你好', voice: 'v1', format: 'wav' }),
    ).rejects.toThrow('500')
  })
})
