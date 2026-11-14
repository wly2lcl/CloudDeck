import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobEvent, TaskContext } from '@clouddeck/contracts'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildScriptHeuristic,
  buildStoryboardHeuristic,
  createLlmDriver,
  HttpLlmProvider,
  renderScriptMarkdown,
} from '../src/index'

const dirs: string[] = []
const servers: Server[] = []

const NARROW = [
  '第一章 风起',
  '夜色沉下来，远处的灯一盏一盏亮起。',
  '张三：“你终于来了，我等了很久。”',
  '第二章 雨落',
  '雨声敲着窗，像有人在门外叩门。',
].join('\n')

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

async function makeContext(capabilityId: string, text: string): Promise<TaskContext> {
  const dir = await mkdtemp(join(tmpdir(), 'clouddeck-llm-'))
  dirs.push(dir)
  const outputDir = join(dir, 'output')
  await mkdir(outputDir, { recursive: true })
  const input = join(dir, 'input.txt')
  await writeFile(input, text)
  const outputType = capabilityId === 'script.generate' ? 'script' : 'storyboard'
  return {
    jobId: 'job',
    tenantId: 'tenant',
    capability: {
      id: capabilityId,
      version: '1.0.0',
      outputs: [{ name: outputType, assetType: outputType, multiple: false }],
    },
    params: { shotsPerScene: 2 },
    inputs: [
      {
        assetId: 'asset',
        version: 1,
        type: capabilityId === 'script.generate' ? 'novel_manuscript' : 'script',
        path: input,
        mime: 'text/plain',
      },
    ],
    workspace: dir,
    outputDir,
    env: {},
    limits: { maxDurationMs: 10_000, maxCostUsd: 1, maxOutputBytes: 1024 * 1024 },
    signal: new AbortController().signal,
    commands: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) },
  }
}

async function collect(driver: ReturnType<typeof createLlmDriver>, ctx: TaskContext) {
  const events: JobEvent[] = []
  for await (const event of driver.events(ctx)) events.push(event)
  return events
}

describe('LLM 启发式生成', () => {
  it('小说拆成多幕剧本', () => {
    const script = buildScriptHeuristic(NARROW, '测试剧本')
    expect(script.acts.length).toBeGreaterThan(0)
    expect(script.acts[0]?.scenes[0]?.dialogues[0]?.role).toBe('张三')
    const markdown = renderScriptMarkdown(script)
    expect(markdown).toContain('## 第一幕')
    expect(markdown).toContain('### 第 1 场')
  })

  it('剧本拆成分镜', () => {
    const markdown = renderScriptMarkdown(buildScriptHeuristic(NARROW))
    const storyboard = buildStoryboardHeuristic(markdown, { shotsPerScene: 2 })
    expect(storyboard.shots.length).toBeGreaterThanOrEqual(4)
    expect(storyboard.shots[0]?.durationMs).toBeGreaterThan(0)
  })
})

describe('LLM driver', () => {
  it('script.generate 产出剧本文件', async () => {
    const ctx = await makeContext('script.generate', NARROW)
    const driver = createLlmDriver()
    const events = await collect(driver, ctx)
    expect(events.some((event) => event.type === 'done')).toBe(true)
    const artifacts = await driver.collect(ctx)
    expect(artifacts[0]?.type).toBe('script')
    const content = await readFile(join(ctx.outputDir, 'script.md'), 'utf8')
    expect(content).toContain('第一幕')
  })

  it('storyboard.plan 产出结构化分镜', async () => {
    const script = renderScriptMarkdown(buildScriptHeuristic(NARROW))
    const ctx = await makeContext('storyboard.plan', script)
    const driver = createLlmDriver()
    const events = await collect(driver, ctx)
    expect(events.some((event) => event.type === 'done')).toBe(true)
    const storyboard = JSON.parse(
      await readFile(join(ctx.outputDir, 'storyboard.json'), 'utf8'),
    ) as { shots: unknown[] }
    expect(storyboard.shots.length).toBeGreaterThanOrEqual(4)
  })
})

describe('driver 从 ctx.env 创建 provider', () => {
  it('使用任务环境中的 LLM 配置', async () => {
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: '环境剧本',
                    acts: [
                      {
                        title: '第一幕',
                        scenes: [
                          {
                            title: '第一场',
                            summary: '测试',
                            characters: [],
                            dialogues: [],
                          },
                        ],
                      },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10 },
          }),
        )
      })
    })
    servers.push(server)
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })

    const ctx = await makeContext('script.generate', NARROW)
    ctx.env = {
      LLM_HTTP_URL: `http://127.0.0.1:${port}/v1`,
      LLM_MODEL: 'test-model',
      LLM_HTTP_TOKEN: 'test-token',
    }
    const driver = createLlmDriver()
    const events = await collect(driver, ctx)
    expect(events.some((event) => event.type === 'done')).toBe(true)
    const content = await readFile(join(ctx.outputDir, 'script.md'), 'utf8')
    expect(content).toContain('环境剧本')
  })
})

describe('HTTP LLM provider', () => {
  it('429 后自动重试并成功', async () => {
    let calls = 0
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        calls += 1
        if (calls === 1) {
          response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' })
          response.end(JSON.stringify({ error: { message: 'rate limit' } }))
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        )
      })
    })
    servers.push(server)
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })

    const provider = new HttpLlmProvider({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'test-model',
      retryBaseDelayMs: 1,
    })
    const result = await provider.complete({ system: 's', prompt: 'p', json: true })
    expect(result.text).toContain('ok')
    expect(calls).toBe(2)
  })

  it('重试耗尽后抛出可读错误', async () => {
    let calls = 0
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        calls += 1
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'rate limit' } }))
      })
    })
    servers.push(server)
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })

    const provider = new HttpLlmProvider({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'test-model',
      maxAttempts: 3,
      retryBaseDelayMs: 1,
    })
    await expect(provider.complete({ system: 's', prompt: 'p' })).rejects.toThrow('429')
    expect(calls).toBe(3)
  })

  it('解析 OpenAI 兼容响应并计算成本', async () => {
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        expect(request.url).toContain('chat/completions')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            choices: [{ message: { content: '{"title":"T","shots":[]}' } }],
            usage: { prompt_tokens: 100, completion_tokens: 100 },
          }),
        )
      })
    })
    servers.push(server)
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })

    const provider = new HttpLlmProvider({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'test-model',
      pricePer1kTokensUsd: 0.002,
    })
    const result = await provider.complete({ system: 's', prompt: 'p', json: true })
    expect(result.text).toContain('title')
    expect(result.costUsd).toBeCloseTo(0.0004, 6)
  })
})
