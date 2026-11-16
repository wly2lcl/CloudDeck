import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobEvent, TaskContext } from '@clouddeck/contracts'
import { LocalSandbox } from '@clouddeck/sandbox'
import { afterEach, describe, expect, it } from 'vitest'
import { createShotFrame } from '../src/bmp'
import { createVideoDriver } from '../src/index'
import { buildTimeline, formatSrtTime, parseStoryboard, toSrt } from '../src/timeline'

const dirs: string[] = []

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const FFMPEG = hasFfmpeg()

const STORYBOARD = {
  title: '测试分镜',
  shots: [
    { index: 1, scene: '第一场', description: '雨夜街道', shotSize: '全景', durationMs: 400 },
    { index: 2, scene: '第一场', description: '主角特写', shotSize: '特写', durationMs: 400 },
  ],
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeContext(storyboard: unknown): Promise<TaskContext> {
  const dir = await mkdtemp(join(tmpdir(), 'clouddeck-video-'))
  dirs.push(dir)
  const outputDir = join(dir, 'output')
  await mkdir(outputDir, { recursive: true })
  const input = join(dir, 'storyboard.json')
  await writeFile(input, JSON.stringify(storyboard))

  return {
    jobId: 'job',
    tenantId: 'tenant',
    capability: {
      id: 'video.render',
      version: '1.0.0',
      outputs: [{ name: 'video', assetType: 'video', multiple: false }],
    },
    params: {},
    inputs: [
      { assetId: 'a', version: 1, type: 'storyboard', path: input, mime: 'application/json' },
    ],
    workspace: dir,
    outputDir,
    env: {},
    limits: { maxDurationMs: 60_000, maxCostUsd: 1, maxOutputBytes: 50 * 1024 * 1024 },
    signal: new AbortController().signal,
    commands: new LocalSandbox(),
  }
}

async function collect(driver: ReturnType<typeof createVideoDriver>, ctx: TaskContext) {
  const events: JobEvent[] = []
  for await (const event of driver.events(ctx)) events.push(event)
  return events
}

describe('BMP 与时间轴', () => {
  it('生成合法 BMP 头与像素数据', () => {
    const bmp = createShotFrame(0, 64, 32)
    expect(bmp.toString('ascii', 0, 2)).toBe('BM')
    expect(bmp.readInt32LE(18)).toBe(64)
    expect(bmp.readInt32LE(22)).toBe(32)
    expect(bmp.length).toBeGreaterThan(54)
  })

  it('时间轴与 SRT 对齐', () => {
    const storyboard = parseStoryboard(JSON.stringify(STORYBOARD))
    const timeline = buildTimeline(storyboard.shots)
    expect(timeline[0]?.startMs).toBe(0)
    expect(timeline[1]?.startMs).toBe(400)
    expect(formatSrtTime(1500)).toBe('00:00:01,500')
    const srt = toSrt(timeline)
    expect(srt).toContain('00:00:00,000 --> 00:00:00,400')
    expect(srt).toContain('雨夜街道')
  })
})

describe('视频 driver', () => {
  it('拒绝非法分镜', async () => {
    const ctx = await makeContext({ shots: [] })
    const driver = createVideoDriver()
    const events = await collect(driver, ctx)
    const error = events.find((event) => event.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('INVALID_STORYBOARD')
  })

  it.skipIf(!FFMPEG)('渲染可播放的 MP4 与字幕', async () => {
    const ctx = await makeContext(STORYBOARD)
    const driver = createVideoDriver({ width: 160, height: 90, fps: 10 })
    const events = await collect(driver, ctx)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.some((event) => event.type === 'done')).toBe(true)

    const video = await stat(join(ctx.outputDir, 'video.mp4'))
    expect(video.size).toBeGreaterThan(1000)
    const header = (await readFile(join(ctx.outputDir, 'video.mp4'))).subarray(4, 8).toString('ascii')
    expect(header).toBe('ftyp')

    const srt = await readFile(join(ctx.outputDir, 'subtitles.srt'), 'utf8')
    expect(srt).toContain('主角特写')

    const artifacts = await driver.collect(ctx)
    expect(artifacts.some((artifact) => artifact.type === 'video')).toBe(true)
  }, 60_000)
})

describe('转场', () => {
  it('按镜头时长生成淡入淡出滤镜', async () => {
    const { fadeFilter } = await import('../src/timeline')
    const filter = fadeFilter(1000)
    expect(filter).toContain('fade=t=in')
    expect(filter).toContain('fade=t=out')
    expect(filter).toContain('st=0.750')
  })
})
