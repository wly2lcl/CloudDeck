import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayHttpProvider } from '../src/providers'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GatewayHttpProvider', () => {
  it('通过控制面网关调用并换算成本', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: { text: '网关结果', usage: { inputTokens: 10, outputTokens: 5 } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new GatewayHttpProvider({
      url: 'http://gateway',
      token: 'job-token',
      pricePer1kTokensUsd: 0.002,
    })
    const result = await provider.complete({ system: 's', prompt: 'p' })
    expect(result.text).toBe('网关结果')
    expect(result.costUsd).toBeCloseTo(0.00003)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://gateway/v1/gateway/chat',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer job-token' }),
      }),
    )
  })
})
