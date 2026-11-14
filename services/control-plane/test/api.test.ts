import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CLAUDE_DRIVER_ID, createClaudeCodeDriver } from '@clouddeck/driver-claude-code'
import { registerDriver, runOnce } from '@clouddeck/job-runner'
import { createFakeProvider, createTtsDriver, TTS_DRIVER_ID } from '@clouddeck/worker-tts'
import { createTestContext, multipartFile, type TestContext } from './helpers'

const FAKE_CLAUDE = fileURLToPath(
  new URL('../../../drivers/claude-code/test/fixtures/fake-claude.mjs', import.meta.url),
)

let ctx: TestContext
let accessToken = ''
let refreshToken = ''
let tenantId = ''
let projectId = ''
let assetId = ''
let completedJobId = ''

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface ApiOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  payload?: unknown
  headers?: Record<string, string>
  token?: string | null
}

async function api(path: string, options: ApiOptions = {}) {
  const token = options.token === undefined ? accessToken : options.token
  return ctx.app.inject({
    method: options.method ?? 'GET',
    url: path,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
    payload: options.payload as never,
  })
}

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.cleanup()
})

describe('M1 端到端', () => {
  it('健康检查与错误信封', async () => {
    const health = await api('/healthz', { token: null })
    expect(health.statusCode).toBe(200)
    expect(health.json().data.status).toBe('ok')

    const missing = await api('/v1/nope', { token: null })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('NOT_FOUND')
  })

  it('注册、登录态与刷新令牌', async () => {
    const response = await api('/v1/auth/register', {
      method: 'POST',
      token: null,
      payload: { email: 'owner@example.com', password: 'password123', displayName: 'Owner' },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json().data
    accessToken = body.accessToken
    refreshToken = body.refreshToken
    tenantId = body.tenantId
    expect(tenantId).toBeTruthy()

    const me = await api('/v1/me')
    expect(me.statusCode).toBe(200)
    expect(me.json().data.user.email).toBe('owner@example.com')
    expect(me.json().data.tenants[0].role).toBe('owner')

    const refreshed = await api('/v1/auth/refresh', {
      method: 'POST',
      token: null,
      payload: { refreshToken },
    })
    expect(refreshed.statusCode).toBe(200)
    accessToken = refreshed.json().data.accessToken
    refreshToken = refreshed.json().data.refreshToken
  })

  it('创建与列出项目', async () => {
    const created = await api('/v1/projects', {
      method: 'POST',
      payload: { name: '示例小说', description: 'M1 验收项目' },
    })
    expect(created.statusCode).toBe(201)
    projectId = created.json().data.id

    const list = await api('/v1/projects')
    expect(list.statusCode).toBe(200)
    expect(list.json().data.some((item: { id: string }) => item.id === projectId)).toBe(true)
  })

  it('上传资产、列出版本并获取签名下载地址', async () => {
    const file = multipartFile('第一章 风起\n', 'chapter-1.txt')
    const uploaded = await api(`/v1/projects/${projectId}/assets?type=novel_manuscript&name=chapter-1.txt`, {
      method: 'POST',
      payload: file.body,
      headers: { 'content-type': file.contentType },
    })
    expect(uploaded.statusCode).toBe(201)
    assetId = uploaded.json().data.assetId
    expect(uploaded.json().data.latestVersion).toBe(1)

    const assets = await api(`/v1/projects/${projectId}/assets`)
    expect(assets.json().data).toHaveLength(1)

    const detail = await api(`/v1/assets/${assetId}`)
    expect(detail.json().data.versions).toHaveLength(1)

    const download = await api(`/v1/assets/${assetId}/versions/1/download`)
    expect(download.statusCode).toBe(302)
    expect(download.headers.location).toContain('/v1/storage/local?')
  })

  it('能力注册表包含 demo.echo 与表单 schema', async () => {
    const list = await api('/v1/capabilities')
    expect(list.statusCode).toBe(200)
    const found = list.json().data.find((item: { id: string }) => item.id === 'demo.echo')
    expect(found).toBeTruthy()

    const detail = await api('/v1/capabilities/demo.echo')
    expect(detail.json().data.form.properties.prefix).toBeTruthy()
  })

  it('提交任务、runner 执行、产物入库与内容链', async () => {
    const created = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'demo.echo',
        inputs: [{ assetId, version: 1 }],
        params: { prefix: 'ECHO: ', steps: 3, sleepMs: 10, costUsd: 0.01 },
      },
    })
    expect(created.statusCode).toBe(201)
    const job = created.json().data
    completedJobId = job.jobId
    expect(job.status).toBe('queued')

    const result = await runOnce({ db: ctx.db, storage: ctx.storage })
    expect(result?.status).toBe('succeeded')

    const detail = await api(`/v1/jobs/${completedJobId}`)
    expect(detail.json().data.status).toBe('succeeded')
    expect(detail.json().data.outputs).toHaveLength(1)

    const assets = await api(`/v1/projects/${projectId}/assets`)
    expect(assets.json().data).toHaveLength(2)
    const produced = assets.json().data.find((item: { type: string }) => item.type === 'document')
    expect(produced.name).toBe('demo.echo.result')

    const logs = await api(`/v1/jobs/${completedJobId}/logs`)
    const types = logs.json().data.map((event: { type: string }) => event.type)
    expect(types).toContain('progress')
    expect(types).toContain('done')

    const usage = await api('/v1/billing/usage')
    expect(usage.json().data.costUsd).toBeGreaterThan(0)
  })

  it('取消运行中的任务', async () => {
    const created = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'demo.echo',
        inputs: [{ assetId, version: 1 }],
        params: { steps: 20, sleepMs: 80 },
      },
    })
    const jobId = created.json().data.jobId

    const running = runOnce({ db: ctx.db, storage: ctx.storage })
    await sleep(150)

    const cancelled = await api(`/v1/jobs/${jobId}/cancel`, { method: 'POST' })
    expect(cancelled.statusCode).toBe(200)

    const result = await running
    expect(result?.status).toBe('cancelled')
  })

  it('超出预算时终止任务', async () => {
    const created = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'demo.echo',
        inputs: [{ assetId, version: 1 }],
        params: { steps: 3, sleepMs: 10, costUsd: 10 },
      },
    })
    const jobId = created.json().data.jobId

    const result = await runOnce({ db: ctx.db, storage: ctx.storage })
    expect(result?.status).toBe('failed')
    expect(result?.errorCode).toBe('BUDGET_EXCEEDED')

    const detail = await api(`/v1/jobs/${jobId}`)
    expect(detail.json().data.errorCode).toBe('BUDGET_EXCEEDED')
  })

  it('失败任务可重试', async () => {
    const created = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'demo.echo',
        inputs: [{ assetId, version: 1 }],
        params: { steps: 3, sleepMs: 10, failAtStep: 2 },
      },
    })
    const jobId = created.json().data.jobId
    const failed = await runOnce({ db: ctx.db, storage: ctx.storage })
    expect(failed?.status).toBe('failed')

    const retried = await api(`/v1/jobs/${jobId}/retry`, { method: 'POST' })
    expect(retried.statusCode).toBe(201)
    expect(retried.json().data.jobId).not.toBe(jobId)
    expect(retried.json().data.status).toBe('queued')

    await runOnce({ db: ctx.db, storage: ctx.storage })
  })

  it('novel.edit 通过 Claude Code driver 产出稿件', async () => {
    registerDriver(CLAUDE_DRIVER_ID, () =>
      createClaudeCodeDriver({ command: process.execPath, commandArgs: [FAKE_CLAUDE] }),
    )

    const created = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'novel.edit',
        inputs: [{ assetId, version: 1 }],
        params: { mode: 'continue', instruction: '续写下一段' },
      },
    })
    expect(created.statusCode).toBe(201)

    const result = await runOnce({ db: ctx.db, storage: ctx.storage })
    expect(result?.status).toBe('succeeded')

    const assets = await api(`/v1/projects/${projectId}/assets`)
    const produced = assets
      .json()
      .data.find(
        (item: { name: string; type: string }) =>
          item.name === 'novel.edit.manuscript' && item.type === 'novel_manuscript',
      )
    expect(produced).toBeTruthy()
  })

  it('audiobook.render 生成逐章音频与合并音频', async () => {
    registerDriver(TTS_DRIVER_ID, () =>
      createTtsDriver({
        provider: createFakeProvider(),
        pricePer1kUsd: 0.002,
        failAtChunk: process.env.TTS_FAIL_AT ? Number(process.env.TTS_FAIL_AT) : undefined,
      }),
    )

    const manuscript = Array.from({ length: 3 }, (_, index) =>
      [
        `第${index + 1}章 测试章节`,
        '夜色沉下来，远处的灯一盏一盏亮起。',
        '张三：“你终于来了，我等了很久。”',
        '李四没有说话，只是把手里的伞递了过去。',
      ].join('\n'),
    ).join('\n')
    const file = multipartFile(manuscript, 'audiobook-source.txt')
    const uploaded = await api(`/v1/projects/${projectId}/assets?type=novel_manuscript&name=audiobook-source.txt`, {
      method: 'POST',
      payload: file.body,
      headers: { 'content-type': file.contentType },
    })
    const sourceAssetId = uploaded.json().data.assetId

    const created = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'audiobook.render',
        inputs: [{ assetId: sourceAssetId, version: 1 }],
        params: { defaultVoice: 'narrator', maxCharsPerChunk: 40 },
      },
    })
    expect(created.statusCode).toBe(201)

    const result = await runOnce({ db: ctx.db, storage: ctx.storage })
    expect(result?.status).toBe('succeeded')

    const assets = await api(`/v1/projects/${projectId}/assets`)
    const audio = assets.json().data.filter((item: { type: string }) => item.type === 'audio_track')
    expect(audio.length).toBeGreaterThanOrEqual(2)
    expect(audio.some((item: { name: string }) => item.name.endsWith('.audiobook'))).toBe(true)
  })

  it('有声任务失败后可续作，只补未完成块', async () => {
    const manuscript = Array.from({ length: 3 }, (_, index) =>
      [
        `第${index + 1}章 续作章节`,
        '雨声敲着窗，像有人在门外轻轻叩门。',
        '张三：“明天我们就出发。”',
        '李四点了点头，把灯调暗了一些。',
      ].join('\n'),
    ).join('\n')
    const file = multipartFile(manuscript, 'audiobook-resume.txt')
    const uploaded = await api(`/v1/projects/${projectId}/assets?type=novel_manuscript&name=audiobook-resume.txt`, {
      method: 'POST',
      payload: file.body,
      headers: { 'content-type': file.contentType },
    })
    const sourceAssetId = uploaded.json().data.assetId

    process.env.TTS_FAIL_AT = '2'
    const created = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'audiobook.render',
        inputs: [{ assetId: sourceAssetId, version: 1 }],
        params: { defaultVoice: 'narrator', maxCharsPerChunk: 40 },
      },
    })
    const jobId = created.json().data.jobId

    const failed = await runOnce({ db: ctx.db, storage: ctx.storage })
    expect(failed?.status).toBe('failed')
    expect(failed?.errorCode).toBe('TTS_FAILED')

    delete process.env.TTS_FAIL_AT

    const resumed = await api(`/v1/jobs/${jobId}/resume`, { method: 'POST' })
    expect(resumed.statusCode).toBe(200)
    expect(resumed.json().data.status).toBe('queued')

    const succeeded = await runOnce({ db: ctx.db, storage: ctx.storage })
    expect(succeeded?.status).toBe('succeeded')

    const logs = await api(`/v1/jobs/${jobId}/logs`)
    expect(
      logs
        .json()
        .data.some((event: { type: string; payload: { message?: string } }) =>
          event.payload?.message?.includes('跳过已完成'),
        ),
    ).toBe(true)
  })

  it('跨租户访问返回 404', async () => {
    const other = await api('/v1/auth/register', {
      method: 'POST',
      token: null,
      payload: { email: 'other@example.com', password: 'password123', displayName: 'Other' },
    })
    const otherToken = other.json().data.accessToken

    const project = await api(`/v1/projects/${projectId}`, { token: otherToken })
    expect(project.statusCode).toBe(404)

    const asset = await api(`/v1/assets/${assetId}`, { token: otherToken })
    expect(asset.statusCode).toBe(404)

    const job = await api(`/v1/jobs/${completedJobId}`, { token: otherToken })
    expect(job.statusCode).toBe(404)
  })

  it('SSE 从 0 补发事件并以 job.end 结束', async () => {
    const url = await ctx.app.listen({ port: 0, host: '127.0.0.1' })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    let text = ''
    try {
      const response = await fetch(`${url}/v1/jobs/${completedJobId}/events?after=0`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      })
      expect(response.status).toBe(200)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('无事件流')
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += new TextDecoder().decode(value)
        if (text.includes('event: job.end')) break
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') throw error
    } finally {
      clearTimeout(timer)
      controller.abort()
    }

    expect(text).toContain('event: job.event')
    expect(text).toContain('"type":"progress"')
    expect(text).toContain('event: job.end')
    expect(text).toContain(`id: `)
  })
})
