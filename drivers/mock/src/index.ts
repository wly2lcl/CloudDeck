import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactSpec, Driver, JobEvent, TaskContext } from '@clouddeck/contracts'

export const MOCK_DRIVER_ID = 'drivers/mock'

interface MockParams {
  prefix?: string
  steps?: number
  sleepMs?: number
  failAtStep?: number
  costUsd?: number
}

const at = () => new Date().toISOString()

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function outputPath(ctx: TaskContext): string {
  return join(ctx.outputDir, 'result.txt')
}

export function createMockDriver(): Driver {
  return {
    id: MOCK_DRIVER_ID,
    protocolVersion: 1,

    async submit() {
      return {}
    },

    async *events(ctx: TaskContext): AsyncGenerator<JobEvent> {
      const params = ctx.params as MockParams
      const steps = Math.min(Math.max(params.steps ?? 3, 1), 20)
      const sleepMs = Math.max(params.sleepMs ?? 150, 0)
      const costUsd = Math.max(params.costUsd ?? 0, 0)

      for (let step = 1; step <= steps; step += 1) {
        if (ctx.signal.aborted) {
          yield { type: 'error', code: 'CANCELLED', message: '任务已取消', retryable: false, at: at() }
          return
        }
        await sleep(sleepMs, ctx.signal)
        if (ctx.signal.aborted) {
          yield { type: 'error', code: 'CANCELLED', message: '任务已取消', retryable: false, at: at() }
          return
        }
        if (params.failAtStep === step) {
          yield {
            type: 'error',
            code: 'MOCK_FAILED',
            message: `第 ${step} 步失败`,
            retryable: true,
            at: at(),
          }
          return
        }
        yield {
          type: 'progress',
          percent: Math.round((step / steps) * 100),
          message: `步骤 ${step}/${steps}`,
          at: at(),
        }
        if (costUsd > 0) {
          yield { type: 'usage', costUsd: Number((costUsd / steps).toFixed(4)), at: at() }
        }
      }

      const source = ctx.inputs[0]
      const sourceText = source ? await readFile(source.path, 'utf8') : ''
      const prefix = params.prefix ?? 'ECHO: '

      await mkdir(ctx.outputDir, { recursive: true })
      await writeFile(outputPath(ctx), `${prefix}${sourceText}`)

      yield {
        type: 'artifact',
        spec: {
          name: 'result',
          type: 'document',
          path: outputPath(ctx),
          mime: 'text/plain',
        },
        at: at(),
      }
      yield { type: 'done', at: at() }
    },

    async cancel() {
      // 取消通过 signal 传递，无需额外清理
    },

    async collect(ctx: TaskContext): Promise<ArtifactSpec[]> {
      return [
        {
          name: 'result',
          type: 'document',
          path: outputPath(ctx),
          mime: 'text/plain',
        },
      ]
    },
  }
}
