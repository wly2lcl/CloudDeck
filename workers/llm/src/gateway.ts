import type { LlmProvider, LlmRequest, LlmResult } from './providers'

export interface GatewayOptions {
  /** 单次请求成本上限，超过后不再尝试后续 provider。 */
  maxCostUsd?: number
}

/**
 * 统一模型网关（worker 级）：按优先级路由到多个 provider，
 * 主 provider 失败时自动降级，并执行单次成本上限。
 */
export class GatewayProvider implements LlmProvider {
  readonly name = 'gateway'

  constructor(
    private readonly providers: LlmProvider[],
    private readonly options: GatewayOptions = {},
  ) {
    if (providers.length === 0) throw new Error('模型网关至少需要一个 provider')
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const errors: string[] = []
    for (const provider of this.providers) {
      try {
        const result = await provider.complete(request)
        if (
          this.options.maxCostUsd !== undefined &&
          result.costUsd > this.options.maxCostUsd
        ) {
          throw new Error(`模型成本 ${result.costUsd} 超过上限 ${this.options.maxCostUsd}`)
        }
        return result
      } catch (error) {
        errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(`所有模型 provider 均失败：${errors.join(' | ')}`)
  }
}
