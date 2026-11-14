import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobEvent, TaskContext } from '@clouddeck/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { createTtsDriver } from '../src/index'
import { createFakeProvider } from '../src/providers'

const dirs: string[] = []

const MANUSCRIPT = [
  '第一章 风起',
  '夜色沉下来，远处的灯一盏一盏亮起。',
  '张三：“你终于来了，我等了很久。”',
  '李四没有说话，只是把手里的伞递了过去。',
  '第二章 雨落',
  '雨声敲着窗，像有人在门外轻轻叩门。',
  '张三：“明天我们就出发。”',
].join('\n')

async function makeContext(): Promise<TaskContext> {
  const dir = await mkdtemp(join(tmpdir(), 'clouddeck-tts-'))
  dirs.push(dir)
  const outputDir = join(dir, 'output')
  await mkdir(outputDir, { recursive: true })
  const input = join(dir, 'book.txt')
  await writeFile(input, MANUSCRIPT)

  return {
    jobId: 'job-tts',
    tenantId: 'tenant-1',
    capability: {
      id: 'audiobook.render',
      version: '1.0.0',
      outputs: [{ name: 'audio', assetType: 'audio_track', multiple: true }],
    },
    params: {
      defaultVoice: 'narrator',
      voiceMap: '{"旁白":"narrator","张三":"voice-zhang"}',
      maxCharsPerChunk: 30,
    },
    inputs: [
      {
        assetId: 'asset-1',
        version: 1,
        type: 'novel_manuscript',
        path: input,
        mime: 'text/plain',
      },
    ],
    workspace: dir,
    outputDir,
    env: {},
    limits: { maxDurationMs: 60_000, maxCostUsd: 1, maxOutputBytes: 10 * 1024 * 1024 },
    signal: new AbortController().signal,
    commands: {
      run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    },
  }
}

async function collect(
  driver: ReturnType<typeof createTtsDriver>,
  ctx: TaskContext,
): Promise<JobEvent[]> {
  const events: JobEvent[] = []
  for await (const event of driver.events(ctx)) events.push(event)
  return events
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('TTS driver', () => {
  it('合成逐章音频与合并音频，并上报用量', async () => {
    const ctx = await makeContext()
    const driver = createTtsDriver({ provider: createFakeProvider(), pricePer1kUsd: 0.002 })
    const events = await collect(driver, ctx)

    expect(events.some((event) => event.type === 'usage')).toBe(true)
    expect(events.some((event) => event.type === 'done')).toBe(true)
    expect(events.some((event) => event.type === 'error')).toBe(false)

    const artifacts = await driver.collect(ctx)
    expect(artifacts.length).toBeGreaterThanOrEqual(3)
    expect(artifacts.some((artifact) => artifact.name === 'audiobook')).toBe(true)
    expect(artifacts.every((artifact) => artifact.type === 'audio_track')).toBe(true)

    const checkpoint = JSON.parse(
      await readFile(join(ctx.outputDir, 'checkpoint.json'), 'utf8'),
    ) as { completed: string[] }
    expect(checkpoint.completed.length).toBeGreaterThan(0)
  })

  it('失败后保留 checkpoint，续作只补未完成块', async () => {
    const ctx = await makeContext()
    const failing = createTtsDriver({
      provider: createFakeProvider(),
      pricePer1kUsd: 0.002,
      failAtChunk: 2,
    })
    const firstEvents = await collect(failing, ctx)
    const error = firstEvents.find((event) => event.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('TTS_FAILED')

    const firstCheckpoint = JSON.parse(
      await readFile(join(ctx.outputDir, 'checkpoint.json'), 'utf8'),
    ) as { completed: string[] }
    expect(firstCheckpoint.completed).toHaveLength(1)

    const resumed = createTtsDriver({ provider: createFakeProvider(), pricePer1kUsd: 0.002 })
    const secondEvents = await collect(resumed, ctx)
    expect(secondEvents.some((event) => event.type === 'error')).toBe(false)
    expect(
      secondEvents.some(
        (event) => event.type === 'log' && event.message.includes('跳过已完成'),
      ),
    ).toBe(true)

    const artifacts = await resumed.collect(ctx)
    expect(artifacts.some((artifact) => artifact.name === 'audiobook')).toBe(true)
  })
})
