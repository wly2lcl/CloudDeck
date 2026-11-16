import { describe, expect, it } from 'vitest'
import { GatewayProvider } from '../src/gateway'
import type { LlmProvider } from '../src/providers'

function provider(name: string, result: () => Promise<{ text: string; costUsd: number }>): LlmProvider {
  return { name, complete: result }
}

describe('GatewayProvider', () => {
  it('主 provider 失败时降级到备用 provider', async () => {
    const gateway = new GatewayProvider([
      provider('primary', async () => {
        throw new Error('429')
      }),
      provider('fallback', async () => ({ text: 'ok', costUsd: 0.01 })),
    ])
    await expect(
      gateway.complete({ system: 's', prompt: 'p' }),
    ).resolves.toMatchObject({ text: 'ok' })
  })

  it('所有 provider 失败时抛出聚合错误', async () => {
    const gateway = new GatewayProvider([
      provider('a', async () => {
        throw new Error('a down')
      }),
      provider('b', async () => {
        throw new Error('b down')
      }),
    ])
    await expect(gateway.complete({ system: 's', prompt: 'p' })).rejects.toThrow(
      /所有模型 provider 均失败/,
    )
  })

  it('超过成本上限时拒绝结果', async () => {
    const gateway = new GatewayProvider(
      [provider('primary', async () => ({ text: 'ok', costUsd: 2 }))],
      { maxCostUsd: 1 },
    )
    await expect(gateway.complete({ system: 's', prompt: 'p' })).rejects.toThrow(/超过上限/)
  })
})
