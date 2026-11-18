import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Driver, JobEvent, TaskContext } from '@clouddeck/contracts'
import { LocalSandbox } from '@clouddeck/sandbox'
import { afterEach, describe, expect, it } from 'vitest'
import { createClaudeCodeDriver } from '../src/index'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url))
const workspaces: string[] = []

const driver = createClaudeCodeDriver({
  command: process.execPath,
  commandArgs: [FIXTURE],
})

async function makeContext(mode: string): Promise<{
  ctx: TaskContext
  controller: AbortController
}> {
  const workspace = await mkdtemp(join(tmpdir(), 'clouddeck-claude-'))
  workspaces.push(workspace)
  const outputDir = join(workspace, 'output')
  await mkdir(outputDir, { recursive: true })
  const controller = new AbortController()
  const manuscript = join(workspace, 'manuscript.md')
  await writeFile(manuscript, '第一章 起点\n林晚走进灯塔。\n第二章 旧信\n她找到母亲的信。')

  return {
    controller,
    ctx: {
      jobId: 'job-1',
      tenantId: 'tenant-1',
      capability: {
        id: 'novel.edit',
        version: '1.0.0',
        outputs: [{ name: 'manuscript', assetType: 'novel_manuscript', multiple: false }],
      },
      params: { instruction: '继续写下一段', mode: 'continue' },
      inputs: [
        {
          assetId: 'asset-1',
          version: 1,
          type: 'novel_manuscript',
          path: manuscript,
          mime: 'text/markdown',
        },
      ],
      workspace,
      outputDir,
      env: { FAKE_MODE: mode, FAKE_OUTPUT_DIR: outputDir },
      limits: { maxDurationMs: 10_000, maxCostUsd: 1, maxOutputBytes: 1024 * 1024 },
      signal: controller.signal,
      commands: new LocalSandbox(),
    },
  }
}

async function collect(driverInstance: Driver, ctx: TaskContext): Promise<JobEvent[]> {
  const events: JobEvent[] = []
  for await (const event of driverInstance.events(ctx)) events.push(event)
  return events
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Claude Code driver', () => {
  it('成功执行：映射日志、用量与 done，并收集产物', async () => {
    const { ctx } = await makeContext('success')
    const events = await collect(driver, ctx)
    const types = events.map((event) => event.type)

    expect(types).toContain('log')
    expect(types).toContain('usage')
    expect(types).toContain('done')
    expect(types).not.toContain('error')

    const usage = events.find((event) => event.type === 'usage')
    expect(usage?.type === 'usage' && usage.costUsd).toBe(0.012)

    const artifacts = await driver.collect(ctx)
    const manuscript = artifacts.find((artifact) => artifact.name === 'manuscript')
    expect(manuscript?.type).toBe('novel_manuscript')
    expect(artifacts.some((artifact) => artifact.name === 'citations')).toBe(true)
  })

  it('进程非零退出映射为 DRIVER_ERROR', async () => {
    const { ctx } = await makeContext('fail')
    const events = await collect(driver, ctx)
    const error = events.find((event) => event.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('DRIVER_ERROR')
    expect(events.some((event) => event.type === 'done')).toBe(false)
  })

  it('缺少产物时返回 NO_ARTIFACT', async () => {
    const { ctx } = await makeContext('no-artifact')
    const events = await collect(driver, ctx)
    const error = events.find((event) => event.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('NO_ARTIFACT')
  })

  it('取消信号终止进程并返回 CANCELLED', async () => {
    const { ctx, controller } = await makeContext('slow')
    const running = collect(driver, ctx)
    setTimeout(() => controller.abort(), 150)
    const events = await running
    const error = events.find((event) => event.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('CANCELLED')
  })
})
