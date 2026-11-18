import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CLAUDE_DRIVER_ID, createClaudeCodeDriver } from '@clouddeck/driver-claude-code'
import { createModelCredential, getCollabDoc, listModelCredentials, withTenant } from '@clouddeck/db'
import { decryptSecret, deriveMasterKey, encryptSecret } from '@clouddeck/secrets'
import { registerDriver, runOnce, signWebhook } from '@clouddeck/job-runner'
import { createLlmDriver, LLM_DRIVER_ID } from '@clouddeck/worker-llm'
import { createFakeProvider, createTtsDriver, TTS_DRIVER_ID } from '@clouddeck/worker-tts'
import { createVideoDriver, VIDEO_DRIVER_ID } from '@clouddeck/worker-video'
import { buildServer } from '../src/app'
import { createTestContext, multipartFile, type TestContext } from './helpers'

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const FFMPEG = hasFfmpeg()

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

let serverUrl: string | null = null
async function ensureListening(): Promise<string> {
  if (!serverUrl) {
    serverUrl = await ctx.app.listen({ port: 0, host: '127.0.0.1' })
  }
  return serverUrl
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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

    expect(ctx.mailer.sent.some((mail) => mail.subject.includes('验证'))).toBe(true)

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

  it('script.generate 与 storyboard.plan 串起内容链', async () => {
    registerDriver(LLM_DRIVER_ID, () => createLlmDriver())

    const scriptJob = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'script.generate',
        inputs: [{ assetId, version: 1 }],
        params: {},
      },
    })
    expect(scriptJob.statusCode).toBe(201)
    expect((await runOnce({ db: ctx.db, storage: ctx.storage }))?.status).toBe('succeeded')

    const afterScript = await api(`/v1/projects/${projectId}/assets`)
    const scriptAsset = afterScript
      .json()
      .data.find((item: { type: string }) => item.type === 'script')
    expect(scriptAsset).toBeTruthy()

    const storyboardJob = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'storyboard.plan',
        inputs: [{ assetId: scriptAsset.assetId, version: scriptAsset.latestVersion }],
        params: { shotsPerScene: 2 },
      },
    })
    expect(storyboardJob.statusCode).toBe(201)
    expect((await runOnce({ db: ctx.db, storage: ctx.storage }))?.status).toBe('succeeded')

    const afterStoryboard = await api(`/v1/projects/${projectId}/assets`)
    expect(
      afterStoryboard.json().data.some((item: { type: string }) => item.type === 'storyboard'),
    ).toBe(true)

    const graph = await api(`/v1/projects/${projectId}/graph`)
    expect(graph.json().data.assets.length).toBeGreaterThan(3)
    expect(graph.json().data.links.length).toBeGreaterThan(0)
  })

  it.skipIf(!FFMPEG)('video.render 合成可播放视频', async () => {
    registerDriver(VIDEO_DRIVER_ID, () =>
      createVideoDriver({ width: 160, height: 90, fps: 10 }),
    )

    const storyboard = {
      title: '测试分镜',
      shots: [
        { index: 1, description: '雨夜街道', shotSize: '全景', durationMs: 400 },
        { index: 2, description: '主角特写', shotSize: '特写', durationMs: 400 },
      ],
    }
    const file = multipartFile(JSON.stringify(storyboard), 'storyboard.json')
    const uploaded = await api(
      `/v1/projects/${projectId}/assets?type=storyboard&name=storyboard.json`,
      {
        method: 'POST',
        payload: file.body,
        headers: { 'content-type': file.contentType },
      },
    )
    const storyboardId = uploaded.json().data.assetId

    const created = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'video.render',
        inputs: [{ assetId: storyboardId, version: 1 }],
        params: {},
      },
    })
    expect(created.statusCode).toBe(201)
    expect((await runOnce({ db: ctx.db, storage: ctx.storage }))?.status).toBe('succeeded')

    const assets = await api(`/v1/projects/${projectId}/assets`)
    expect(assets.json().data.some((item: { type: string }) => item.type === 'video')).toBe(true)
  }, 60_000)

  it('任务终态触发 webhook 并记录投递', async () => {
    const received: { body: string; signature: string; timestamp: string }[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        received.push({
          body,
          signature: String(request.headers['x-clouddeck-signature'] ?? ''),
          timestamp: String(request.headers['x-clouddeck-timestamp'] ?? ''),
        })
        response.writeHead(200)
        response.end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      const hook = await api('/v1/webhooks', {
        method: 'POST',
        payload: {
          url: `http://127.0.0.1:${port}/hook`,
          events: ['job.succeeded'],
        },
      })
      expect(hook.statusCode).toBe(201)
      const secret = hook.json().data.secret as string

      const created = await api(`/v1/projects/${projectId}/jobs`, {
        method: 'POST',
        payload: {
          capabilityId: 'demo.echo',
          inputs: [{ assetId, version: 1 }],
          params: { steps: 2, sleepMs: 5 },
        },
      })
      expect(created.statusCode).toBe(201)
      expect((await runOnce({ db: ctx.db, storage: ctx.storage }))?.status).toBe('succeeded')

      expect(received).toHaveLength(1)
      const payload = received[0] as (typeof received)[number]
      expect(payload.signature).toBe(signWebhook(secret, payload.timestamp, payload.body))

      const deliveries = await api('/v1/webhook-deliveries')
      expect(deliveries.json().data[0].status).toBe('delivered')

      const replay = await api(`/v1/webhook-deliveries/${deliveries.json().data[0].id}/replay`, {
        method: 'POST',
      })
      expect(replay.statusCode).toBe(200)
      expect(replay.json().data.delivered).toBe(true)
      expect(received).toHaveLength(2)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('套餐切换更新配额，用量可按能力汇总', async () => {
    const tenant = await api('/v1/tenant')
    expect(tenant.json().data.tier).toBe('free')

    const upgraded = await api('/v1/tenant', {
      method: 'PATCH',
      payload: { tier: 'pro' },
    })
    expect(upgraded.statusCode).toBe(200)
    expect(upgraded.json().data.tier).toBe('pro')

    const quota = await api('/v1/billing/quota')
    expect(quota.json().data.maxCostUsd).toBe(100)
    expect(quota.json().data.maxConcurrency).toBe(4)

    const summary = await api('/v1/billing/summary')
    expect(summary.statusCode).toBe(200)
    const capabilities = summary
      .json()
      .data.items.map((item: { capabilityId: string }) => item.capabilityId)
    expect(capabilities).toContain('demo.echo')
    expect(capabilities).toContain('audiobook.render')
  })

  it('能力开关会隐藏能力并拒绝新建任务', async () => {
    const disabled = await api('/v1/capabilities/demo.echo/enabled', {
      method: 'PUT',
      payload: { enabled: false },
    })
    expect(disabled.statusCode).toBe(200)

    const list = await api('/v1/capabilities')
    expect(list.json().data.some((item: { id: string }) => item.id === 'demo.echo')).toBe(false)

    const rejected = await api(`/v1/projects/${projectId}/jobs`, {
      method: 'POST',
      payload: {
        capabilityId: 'demo.echo',
        inputs: [{ assetId, version: 1 }],
        params: {},
      },
    })
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json().error.code).toBe('CAPABILITY_UNAVAILABLE')

    await api('/v1/capabilities/demo.echo/enabled', {
      method: 'PUT',
      payload: { enabled: true },
    })
    const restored = await api('/v1/capabilities')
    expect(restored.json().data.some((item: { id: string }) => item.id === 'demo.echo')).toBe(true)
    expect(restored.json().data.some((item: { id: string }) => item.id === 'coding.assist')).toBe(true)
  })

  it('模板可创建项目并删除', async () => {
    const created = await api('/v1/templates', {
      method: 'POST',
      payload: { name: '小说项目模板', description: '默认设定与目录' },
    })
    expect(created.statusCode).toBe(201)
    const templateId = created.json().data.id

    const list = await api('/v1/templates')
    expect(list.json().data.some((item: { id: string }) => item.id === templateId)).toBe(true)

    const project = await api(`/v1/templates/${templateId}/projects`, {
      method: 'POST',
      payload: { name: '来自模板的项目' },
    })
    expect(project.statusCode).toBe(201)
    expect(project.json().data.name).toBe('来自模板的项目')

    const removed = await api(`/v1/templates/${templateId}`, { method: 'DELETE' })
    expect(removed.statusCode).toBe(200)
  })

  it('凭据主密钥轮换后可解密', async () => {
    const oldKey = deriveMasterKey('old-credentials-key')
    const credential = await withTenant(ctx.db, tenantId, (tx) =>
      createModelCredential(tx, {
        tenantId,
        provider: 'dashscope',
        label: '待轮换凭据',
        encryptedSecret: encryptSecret('sk-rotate-me', oldKey),
        keyHint: '****-me',
      }),
    )

    const rotated = await api('/v1/model-credentials/rotate', { method: 'POST', payload: {} })
    expect(rotated.statusCode).toBe(200)
    expect(rotated.json().data.rotated).toBeGreaterThanOrEqual(1)

    const rows = await withTenant(ctx.db, tenantId, (tx) =>
      listModelCredentials(tx, tenantId),
    )
    const stored = rows.find((row: { id: string }) => row.id === credential.id)
    const plaintext = decryptSecret(
      stored?.encrypted_secret ?? '',
      deriveMasterKey('test-credentials-key'),
    )
    expect(plaintext).toBe('sk-rotate-me')
  })

  it('模型凭据加密存储、列表脱敏并可删除', async () => {
    const created = await api('/v1/model-credentials', {
      method: 'POST',
      payload: { provider: 'dashscope', label: '测试凭据', secret: 'sk-test-secret-1234' },
    })
    expect(created.statusCode).toBe(201)
    const credential = created.json().data
    expect(credential.keyHint).toBe('****1234')
    expect(JSON.stringify(credential)).not.toContain('sk-test-secret')

    const verify = await api(`/v1/model-credentials/${credential.id}/verify`)
    expect(verify.json().data.ok).toBe(true)

    const rows = await withTenant(ctx.db, tenantId, (tx) =>
      listModelCredentials(tx, tenantId),
    )
    const stored = rows.find((row: { id: string }) => row.id === credential.id)
    expect(stored?.encrypted_secret.startsWith('v1:')).toBe(true)
    expect(stored?.encrypted_secret).not.toContain('sk-test-secret')

    const removed = await api(`/v1/model-credentials/${credential.id}`, { method: 'DELETE' })
    expect(removed.statusCode).toBe(200)
  })

  it('项目评论可创建、列出与删除', async () => {
    const created = await api(`/v1/projects/${projectId}/comments`, {
      method: 'POST',
      payload: { body: '第一章节奏可以再快一点' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().data.canDelete).toBe(true)
    const commentId = created.json().data.id

    const list = await api(`/v1/projects/${projectId}/comments`)
    expect(
      list.json().data.some((comment: { id: string }) => comment.id === commentId),
    ).toBe(true)

    const removed = await api(`/v1/comments/${commentId}`, { method: 'DELETE' })
    expect(removed.statusCode).toBe(200)

    const after = await api(`/v1/projects/${projectId}/comments`)
    expect(
      after.json().data.some((comment: { id: string }) => comment.id === commentId),
    ).toBe(false)
  })

  it('对账与账单快照可重复生成', async () => {
    const reconciliation = await api('/v1/billing/reconciliation')
    expect(reconciliation.statusCode).toBe(200)
    expect(reconciliation.json().data.jobs.length).toBeGreaterThan(0)
    expect(reconciliation.json().data.totals.actualCostUsd).toBeGreaterThan(0)

    const created = await api('/v1/billing/invoices', { method: 'POST', payload: {} })
    expect([200, 201]).toContain(created.statusCode)
    expect(created.json().data.totalUsd).toBeGreaterThan(0)
    const invoiceId = created.json().data.id

    const again = await api('/v1/billing/invoices', { method: 'POST', payload: {} })
    expect(again.json().data.id).toBe(invoiceId)

    const list = await api('/v1/billing/invoices')
    expect(list.json().data.some((item: { id: string }) => item.id === invoiceId)).toBe(true)

    const detail = await api(`/v1/billing/invoices/${invoiceId}`)
    expect(detail.json().data.snapshot).toBeTruthy()
  })

  it('支付下单与回调升级套餐', async () => {
    const checkout = await api('/v1/billing/checkout', {
      method: 'POST',
      payload: { tier: 'team' },
    })
    expect(checkout.statusCode).toBe(200)
    const externalId = checkout.json().data.externalId as string
    expect(externalId).toBeTruthy()

    const body = { externalId, status: 'paid', tier: 'team' }
    const signature = createHmac('sha256', 'test-payment-secret')
      .update(JSON.stringify(body))
      .digest('hex')
    const webhook = await api('/v1/billing/webhook/mock', {
      method: 'POST',
      token: null,
      payload: body,
      headers: { 'x-payment-signature': signature },
    })
    expect(webhook.statusCode).toBe(200)

    const tenant = await api('/v1/tenant')
    expect(tenant.json().data.tier).toBe('team')

    const payments = await api('/v1/billing/payments')
    expect(
      payments.json().data.some(
        (item: { externalId?: string; status: string }) => item.status === 'paid',
      ),
    ).toBe(true)

    const invalid = await api('/v1/billing/webhook/mock', {
      method: 'POST',
      token: null,
      payload: body,
      headers: { 'x-payment-signature': 'bad-signature' },
    })
    expect(invalid.statusCode).toBe(403)
  })

  it('设备令牌可注册与删除', async () => {
    const token = `device-token-${Date.now()}`
    const created = await api('/v1/devices', {
      method: 'POST',
      payload: { platform: 'android', token },
    })
    expect(created.statusCode).toBe(201)

    const removed = await api(`/v1/devices/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    })
    expect(removed.statusCode).toBe(200)
  })

  it('账单可输出可打印 HTML', async () => {
    const created = await api('/v1/billing/invoices', { method: 'POST', payload: {} })
    const invoiceId = created.json().data.id
    const html = await api(`/v1/billing/invoices/${invoiceId}/html`)
    expect(html.statusCode).toBe(200)
    expect(html.headers['content-type']).toContain('text/html')
    expect(html.body).toContain('CloudDeck 月度账单')
    expect(html.body).toContain('合计')
  })

  it('安全响应头与登录限流生效', async () => {
    const health = await api('/healthz', { token: null })
    expect(health.headers['x-content-type-options']).toBe('nosniff')

    const limited = await buildServer({
      db: ctx.db,
      storage: ctx.storage,
      config: ctx.config,
      mailer: ctx.mailer,
    })
    await limited.ready()
    try {
      let limitedStatus = 0
      for (let i = 0; i < 25; i += 1) {
        const response = await limited.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: 'nobody@example.com', password: 'wrong-password' },
        })
        limitedStatus = response.statusCode
      }
      expect(limitedStatus).toBe(429)
    } finally {
      await limited.close()
    }
  })

  it('指标端点暴露任务与请求计数', async () => {
    const metrics = await api('/metrics', { token: null })
    expect(metrics.statusCode).toBe(200)
    expect(metrics.body).toContain('clouddeck_up 1')
    expect(metrics.body).toContain('clouddeck_jobs{status=')
    expect(metrics.body).toContain('clouddeck_http_requests_total')
  })

  it('模板可公开并被其他租户导入', async () => {
    const created = await api('/v1/templates', {
      method: 'POST',
      payload: { name: '市场模板', description: '公开测试模板' },
    })
    const templateId = created.json().data.id

    const published = await api(`/v1/templates/${templateId}/public`, {
      method: 'PATCH',
      payload: { isPublic: true },
    })
    expect(published.statusCode).toBe(200)

    const other = await api('/v1/auth/register', {
      method: 'POST',
      token: null,
      payload: { email: 'market@example.com', password: 'password123', displayName: 'Market' },
    })
    const otherToken = other.json().data.accessToken

    const publicList = await api('/v1/templates/public', { token: otherToken })
    expect(
      publicList.json().data.some((item: { id: string }) => item.id === templateId),
    ).toBe(true)

    const imported = await api(`/v1/templates/public/${templateId}/import`, {
      method: 'POST',
      token: otherToken,
      payload: {},
    })
    expect(imported.statusCode).toBe(201)
    expect(imported.json().data.name).toBe('市场模板')

    const otherTemplates = await api('/v1/templates', { token: otherToken })
    expect(
      otherTemplates
        .json()
        .data.some((item: { id: string }) => item.id === imported.json().data.id),
    ).toBe(true)
  })

  it('评论 SSE 可回放评论', async () => {
    await api(`/v1/projects/${projectId}/comments`, {
      method: 'POST',
      payload: { body: '实时评论测试' },
    })

    const url = await ensureListening()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    let text = ''
    try {
      const response = await fetch(
        `${url}/v1/projects/${projectId}/comments/stream?after=1970-01-01T00:00:00.000Z`,
        {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        },
      )
      expect(response.status).toBe(200)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无评论流')
      while (!text.includes('实时评论测试')) {
        const { done, value } = await reader.read()
        if (done) break
        text += new TextDecoder().decode(value)
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') throw error
    } finally {
      clearTimeout(timer)
      controller.abort()
    }

    expect(text).toContain('event: comment')
    expect(text).toContain('实时评论测试')
  }, 15_000)

  it('月度账单汇总总额与明细一致', async () => {
    const statement = await api('/v1/billing/statement')
    expect(statement.statusCode).toBe(200)
    const data = statement.json().data as {
      totalUsd: number
      items: { amountUsd: number }[]
      jobCount: number
    }
    expect(data.totalUsd).toBeGreaterThan(0)
    const sum = data.items.reduce((total, item) => total + item.amountUsd, 0)
    expect(data.totalUsd).toBeCloseTo(sum, 4)
    expect(data.jobCount).toBeGreaterThan(0)
  })

  it('只读分享可公开访问，撤销后失效', async () => {
    const created = await api(`/v1/projects/${projectId}/shares`, {
      method: 'POST',
      payload: { expiresInDays: 7 },
    })
    expect(created.statusCode).toBe(201)
    const { token, id: shareId } = created.json().data as { token: string; id: string }

    const publicProject = await api(`/v1/public/shares/${token}`, { token: null })
    expect(publicProject.statusCode).toBe(200)
    expect(publicProject.json().data.project.id).toBe(projectId)
    expect(publicProject.json().data.assets.length).toBeGreaterThan(0)

    const content = await api(
      `/v1/public/shares/${token}/assets/${assetId}/content`,
      { token: null },
    )
    expect(content.statusCode).toBe(200)
    expect(content.json().data.text).toContain('第一章')

    const revoked = await api(`/v1/shares/${shareId}`, { method: 'DELETE' })
    expect(revoked.statusCode).toBe(200)

    const after = await api(`/v1/public/shares/${token}`, { token: null })
    expect(after.statusCode).toBe(404)
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
    const url = await ensureListening()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    let text = ''
    try {
      const response = await fetch(`${url}/v1/jobs/${completedJobId}/events?after=0`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          origin: 'http://localhost:3000',
        },
        signal: controller.signal,
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
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

describe('第一阶段收口', () => {
  let memberToken = ''
  let memberRefresh = ''
  let memberId = ''
  let verificationToken = ''
  let apiKey = ''

  it('注册返回邮箱验证令牌，验证后 /me 标记已验证', async () => {
    const response = await api('/v1/auth/register', {
      method: 'POST',
      token: null,
      payload: { email: 'member@example.com', password: 'password123', displayName: 'Member' },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json().data
    memberToken = body.accessToken
    memberRefresh = body.refreshToken
    memberId = body.user.id
    verificationToken = body.emailVerificationToken
    expect(verificationToken).toBeTruthy()

    const verified = await api('/v1/auth/verify-email', {
      method: 'POST',
      token: null,
      payload: { token: verificationToken },
    })
    expect(verified.statusCode).toBe(200)

    const me = await api('/v1/me', { token: memberToken })
    expect(me.statusCode).toBe(200)
    expect(me.json().data.user.emailVerified).toBe(true)
  })

  it('owner 可添加、改角色、移除成员，并写入审计', async () => {
    const added = await api(`/v1/tenants/${tenantId}/members`, {
      method: 'POST',
      payload: { email: 'member@example.com', role: 'editor' },
    })
    expect(added.statusCode).toBe(201)
    expect(added.json().data.role).toBe('editor')

    const list = await api(`/v1/tenants/${tenantId}/members`)
    expect(list.statusCode).toBe(200)
    expect(list.json().data.some((item: { userId: string }) => item.userId === memberId)).toBe(true)

    const patched = await api(`/v1/tenants/${tenantId}/members/${memberId}`, {
      method: 'PATCH',
      payload: { role: 'viewer' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().data.role).toBe('viewer')

    const auditLogs = await api('/v1/audit-logs')
    expect(auditLogs.statusCode).toBe(200)
    const actions = auditLogs.json().data.map((item: { action: string }) => item.action)
    expect(actions).toContain('member.add')
    expect(actions).toContain('member.role')
    expect(actions).toContain('auth.register')
  })

  it('API Key 可鉴权，撤销后立即失效', async () => {
    const created = await api('/v1/api-keys', {
      method: 'POST',
      payload: { name: 'CI key' },
    })
    expect(created.statusCode).toBe(201)
    apiKey = created.json().data.key
    expect(apiKey.startsWith('cdk_')).toBe(true)

    const list = await api('/v1/projects', {
      token: null,
      headers: { 'x-api-key': apiKey },
    })
    expect(list.statusCode).toBe(200)

    const keyId = created.json().data.id
    const revoked = await api(`/v1/api-keys/${keyId}`, { method: 'DELETE' })
    expect(revoked.statusCode).toBe(200)

    const denied = await api('/v1/projects', {
      token: null,
      headers: { 'x-api-key': apiKey },
    })
    expect(denied.statusCode).toBe(401)
  })

  it('忘记密码、重置密码并吊销旧会话', async () => {
    const forgot = await api('/v1/auth/forgot-password', {
      method: 'POST',
      token: null,
      payload: { email: 'member@example.com' },
    })
    expect(forgot.statusCode).toBe(200)
    const resetToken = forgot.json().data.token as string
    expect(resetToken).toBeTruthy()
    expect(ctx.mailer.sent.some((mail) => mail.text.includes(resetToken))).toBe(true)

    const reset = await api('/v1/auth/reset-password', {
      method: 'POST',
      token: null,
      payload: { token: resetToken, password: 'newpassword123' },
    })
    expect(reset.statusCode).toBe(200)

    const oldRefresh = await api('/v1/auth/refresh', {
      method: 'POST',
      token: null,
      payload: { refreshToken: memberRefresh },
    })
    expect(oldRefresh.statusCode).toBe(401)

    const oldLogin = await api('/v1/auth/login', {
      method: 'POST',
      token: null,
      payload: { email: 'member@example.com', password: 'password123' },
    })
    expect(oldLogin.statusCode).toBe(401)

    const login = await api('/v1/auth/login', {
      method: 'POST',
      token: null,
      payload: { email: 'member@example.com', password: 'newpassword123' },
    })
    expect(login.statusCode).toBe(200)
  })

  it('移除成员后不再出现在列表', async () => {
    const removed = await api(`/v1/tenants/${tenantId}/members/${memberId}`, {
      method: 'DELETE',
    })
    expect(removed.statusCode).toBe(200)

    const list = await api(`/v1/tenants/${tenantId}/members`)
    expect(list.json().data.some((item: { userId: string }) => item.userId === memberId)).toBe(false)
  })
})

describe('平台管理', () => {
  it('owner 是平台管理员，普通用户被拒绝', async () => {
    const me = await api('/v1/me')
    expect(me.json().data.platformAdmin).toBe(true)

    const tenants = await api('/v1/admin/tenants')
    expect(tenants.statusCode).toBe(200)
    expect(tenants.json().data.some((item: { id: string }) => item.id === tenantId)).toBe(true)

    const registered = await api('/v1/auth/register', {
      method: 'POST',
      token: null,
      payload: { email: 'plain@example.com', password: 'password123' },
    })
    const plainToken = registered.json().data.accessToken as string
    const denied = await api('/v1/admin/tenants', { token: plainToken })
    expect(denied.statusCode).toBe(403)
  })

  it('可调整租户套餐与配额，并查看跨租户任务', async () => {
    const plan = await api(`/v1/admin/tenants/${tenantId}/plan`, {
      method: 'PATCH',
      payload: { tier: 'team' },
    })
    expect(plan.statusCode).toBe(200)
    expect(plan.json().data.tier).toBe('team')

    const quota = await api(`/v1/admin/tenants/${tenantId}/quota`, {
      method: 'PATCH',
      payload: { maxCostUsd: 2000, maxJobs: 20000, maxConcurrency: 32 },
    })
    expect(quota.statusCode).toBe(200)

    const jobs = await api('/v1/admin/jobs?limit=5')
    expect(jobs.statusCode).toBe(200)
    expect(jobs.json().data.length).toBeGreaterThan(0)
    expect(jobs.json().data[0].tenantName).toBeTruthy()

    const toggle = await api('/v1/admin/capabilities/demo.echo', {
      method: 'PATCH',
      payload: { enabled: false },
    })
    expect(toggle.statusCode).toBe(200)
    await api('/v1/admin/capabilities/demo.echo', {
      method: 'PATCH',
      payload: { enabled: true },
    })
  })
})

describe('邀请流程', () => {
  it('邀请未注册邮箱并通过令牌加入租户', async () => {
    const invited = await api(`/v1/tenants/${tenantId}/members`, {
      method: 'POST',
      payload: { email: 'invitee@example.com', role: 'editor' },
    })
    expect(invited.statusCode).toBe(201)
    expect(invited.json().data.invited).toBe(true)
    const token = invited.json().data.token as string
    expect(token).toBeTruthy()
    expect(ctx.mailer.sent.some((mail) => mail.text.includes(token))).toBe(true)

    const list = await api('/v1/tenant-invitations')
    expect(list.json().data.some((item: { email: string }) => item.email === 'invitee@example.com')).toBe(true)

    const accepted = await api('/v1/auth/accept-invite', {
      method: 'POST',
      token: null,
      payload: { token, password: 'password123', displayName: 'Invitee' },
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().data.role).toBe('editor')

    const login = await api('/v1/auth/login', {
      method: 'POST',
      token: null,
      payload: { email: 'invitee@example.com', password: 'password123', tenantId },
    })
    expect(login.statusCode).toBe(200)

    const members = await api(`/v1/tenants/${tenantId}/members`)
    expect(members.json().data.some((item: { email: string }) => item.email === 'invitee@example.com')).toBe(true)
  })
})

describe('项目级 ACL', () => {
  it('添加项目成员后仅成员与 owner/admin 可访问', async () => {
    const aclReg = await api('/v1/auth/register', {
      method: 'POST',
      token: null,
      payload: { email: 'acl@example.com', password: 'password123' },
    })
    const aclId = aclReg.json().data.user.id as string
    await api('/v1/auth/register', {
      method: 'POST',
      token: null,
      payload: { email: 'outsider@example.com', password: 'password123' },
    })

    for (const email of ['acl@example.com', 'outsider@example.com']) {
      const added = await api(`/v1/tenants/${tenantId}/members`, {
        method: 'POST',
        payload: { email, role: 'editor' },
      })
      expect(added.statusCode).toBe(201)
    }

    const aclLogin = await api('/v1/auth/login', {
      method: 'POST',
      token: null,
      payload: { email: 'acl@example.com', password: 'password123', tenantId },
    })
    const aclToken = aclLogin.json().data.accessToken as string
    const outsiderLogin = await api('/v1/auth/login', {
      method: 'POST',
      token: null,
      payload: { email: 'outsider@example.com', password: 'password123', tenantId },
    })
    const outsiderToken = outsiderLogin.json().data.accessToken as string

    const addedMember = await api(`/v1/projects/${projectId}/members`, {
      method: 'POST',
      payload: { email: 'acl@example.com', role: 'editor' },
    })
    expect(addedMember.statusCode).toBe(201)

    expect((await api(`/v1/projects/${projectId}`, { token: aclToken })).statusCode).toBe(200)
    expect((await api(`/v1/projects/${projectId}/assets`, { token: aclToken })).statusCode).toBe(200)
    expect((await api(`/v1/projects/${projectId}`, { token: outsiderToken })).statusCode).toBe(404)
    expect((await api(`/v1/projects/${projectId}/assets`, { token: outsiderToken })).statusCode).toBe(404)

    const removed = await api(`/v1/projects/${projectId}/members/${aclId}`, {
      method: 'DELETE',
    })
    expect(removed.statusCode).toBe(200)
    expect((await api(`/v1/projects/${projectId}`, { token: outsiderToken })).statusCode).toBe(200)
  })
})

describe('控制面模型网关', () => {
  it('代理 chat/completions 并返回文本与用量', async () => {
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        const payload = JSON.parse(body) as { model?: string }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            choices: [{ message: { content: `echo:${payload.model}` } }],
            usage: { prompt_tokens: 3, completion_tokens: 5 },
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const previous = ctx.config.gatewayBaseUrl
    ctx.config.gatewayBaseUrl = `http://127.0.0.1:${port}`
    try {
      const response = await api('/v1/gateway/chat', {
        method: 'POST',
        payload: { messages: [{ role: 'user', content: 'hello' }], maxTokens: 16 },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().data.text).toBe('echo:test-model')
      expect(response.json().data.usage.inputTokens).toBe(3)

      const jobToken = await api(`/v1/jobs/${completedJobId}/gateway-token`, { method: 'POST' })
      expect(jobToken.statusCode).toBe(200)
      const viaJob = await api('/v1/gateway/chat', {
        method: 'POST',
        token: jobToken.json().data.token,
        payload: { messages: [{ role: 'user', content: 'hello' }], maxTokens: 16 },
      })
      expect(viaJob.statusCode).toBe(200)
    } finally {
      ctx.config.gatewayBaseUrl = previous
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('实时协作', () => {
  it('两个客户端通过 Yjs 房间同步文本', async () => {
    const { default: WebSocket } = await import('ws')
    const Y = await import('yjs')
    const { WebsocketProvider } = await import('y-websocket')
    const url = await ensureListening()
    const wsUrl = url.replace(/^http/, 'ws')

    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const providerA = new WebsocketProvider(wsUrl, `${projectId}_manuscript`, docA, {
      params: { token: accessToken },
      WebSocketPolyfill: WebSocket as never,
    })
    const providerB = new WebsocketProvider(wsUrl, `${projectId}_manuscript`, docB, {
      params: { token: accessToken },
      WebSocketPolyfill: WebSocket as never,
    })

    try {
      await new Promise<void>((resolve) => {
        let ready = 0
        const check = () => {
          ready += 1
          if (ready >= 2) resolve()
        }
        providerA.on('sync', check)
        providerB.on('sync', check)
        setTimeout(resolve, 3000)
      })

      docA.getText('content').insert(0, '协作内容')
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (docB.getText('content').toString() === '协作内容') {
            clearInterval(timer)
            resolve()
          }
        }, 50)
        setTimeout(() => {
          clearInterval(timer)
          resolve()
        }, 3000)
      })
      expect(docB.getText('content').toString()).toBe('协作内容')
      providerA.destroy()
      providerB.destroy()
    } finally {
      providerA.destroy()
      providerB.destroy()
      docA.destroy()
      docB.destroy()
    }
  })
})


describe('协作文档持久化', () => {
  it('按租户/项目/文档读写 Yjs 状态', async () => {
    const { upsertCollabDoc } = await import('@clouddeck/db')
    await withTenant(ctx.db, tenantId, (tx) =>
      upsertCollabDoc(tx, {
        tenantId,
        projectId,
        docId: 'persist-test',
        stateB64: Buffer.from('state').toString('base64'),
      }),
    )
    const saved = await withTenant(ctx.db, tenantId, (tx) =>
      getCollabDoc(tx, tenantId, projectId, 'persist-test'),
    )
    expect(saved).toBe(Buffer.from('state').toString('base64'))
  })
})

describe('角色音色库', () => {
  it('创建、列出并删除音色配置', async () => {
    const created = await api('/v1/voice-profiles', {
      method: 'POST',
      payload: {
        name: '旁白音色',
        provider: 'dashscope',
        voiceId: 'longanhuan_v3.1',
        roleMap: { 旁白: 'longanhuan_v3.1' },
      },
    })
    expect(created.statusCode).toBe(201)
    const id = created.json().data.id as string

    const list = await api('/v1/voice-profiles')
    expect(list.json().data.some((item: { id: string }) => item.id === id)).toBe(true)

    const deleted = await api(`/v1/voice-profiles/${id}`, { method: 'DELETE' })
    expect(deleted.statusCode).toBe(200)
  })
})

describe('字幕样式预设', () => {
  it('保存、列出并删除自定义样式预设', async () => {
    const created = await api('/v1/subtitle-style-presets', {
      method: 'POST',
      payload: { name: '夜间字幕', style: { fontSize: '24', alignment: '2', marginV: '32', outline: '2' } },
    })
    expect(created.statusCode).toBe(201)
    const id = created.json().data.id as string

    const list = await api('/v1/subtitle-style-presets')
    expect(list.json().data.some((item: { id: string }) => item.id === id)).toBe(true)

    const deleted = await api(`/v1/subtitle-style-presets/${id}`, { method: 'DELETE' })
    expect(deleted.statusCode).toBe(200)
  })
})

describe('字幕预设导入导出', () => {
  it('导入预设并导出为共享 JSON', async () => {
    const imported = await api('/v1/subtitle-style-presets/import', {
      method: 'POST',
      payload: {
        presets: [
          { name: '导入预设', style: { fontSize: '26', alignment: '8', marginV: '28', outline: '2' } },
        ],
      },
    })
    expect(imported.statusCode).toBe(200)
    expect(imported.json().data.imported).toBe(1)

    const exported = await api('/v1/subtitle-style-presets/export')
    expect(exported.statusCode).toBe(200)
    expect(exported.json().data.presets.some((item: { name: string }) => item.name === '导入预设')).toBe(true)
  })
})

describe('字幕预设版本历史', () => {
  it('保存生成版本并可恢复', async () => {
    const first = await api('/v1/subtitle-style-presets', {
      method: 'POST',
      payload: { name: '版本预设', style: { fontSize: '20', alignment: '2', marginV: '24', outline: '1' } },
    })
    const id = first.json().data.id as string
    await api('/v1/subtitle-style-presets', {
      method: 'POST',
      payload: { name: '版本预设', style: { fontSize: '30', alignment: '8', marginV: '40', outline: '3' } },
    })

    const versions = await api(`/v1/subtitle-style-presets/${id}/versions`)
    expect(versions.statusCode).toBe(200)
    expect(versions.json().data).toHaveLength(2)

    const restored = await api(`/v1/subtitle-style-presets/${id}/versions/1/restore`, {
      method: 'POST',
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json().data.style.fontSize).toBe('20')
  })
})
