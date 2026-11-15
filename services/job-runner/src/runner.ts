import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CommandRunner, Driver, JobEvent, TaskContext } from '@clouddeck/contracts'
import {
  appendJobEvent,
  claimNextJob,
  createAsset,
  getAssetVersionDetail,
  getCapability,
  insertJobArtifact,
  insertUsage,
  isCancelRequested,
  linkAssets,
  listModelCredentials,
  periodOf,
  touchModelCredential,
  setJobOutputs,
  setJobStatus,
  sumJobUsage,
  type Database,
  type JobRow,
} from '@clouddeck/db'
import {
  CLAUDE_DRIVER_ID,
  createClaudeCodeDriver,
} from '@clouddeck/driver-claude-code'
import { createMockDriver, MOCK_DRIVER_ID } from '@clouddeck/driver-mock'
import { LocalSandbox } from '@clouddeck/sandbox'
import { decryptSecret, deriveMasterKey } from '@clouddeck/secrets'
import { storageKeyFor, type Storage } from '@clouddeck/storage'
import { createLlmDriver, LLM_DRIVER_ID } from '@clouddeck/worker-llm'
import { createTtsDriver, TTS_DRIVER_ID } from '@clouddeck/worker-tts'
import { createVideoDriver, VIDEO_DRIVER_ID } from '@clouddeck/worker-video'
import { dispatchJobPush, type PushOptions } from './push'
import { dispatchJobWebhooks, type WebhookDispatchOptions } from './webhooks'

export { dispatchJobWebhooks, signWebhook } from './webhooks'
export type { WebhookDispatchOptions } from './webhooks'

export type DriverFactory = () => Driver

const DEFAULT_CAPABILITIES_DIR = fileURLToPath(
  new URL('../../../capabilities/', import.meta.url),
)

const DRIVERS: Record<string, DriverFactory> = {
  [MOCK_DRIVER_ID]: createMockDriver,
  [CLAUDE_DRIVER_ID]: () =>
    createClaudeCodeDriver({
      command: process.env.CLAUDE_BIN,
      commandArgs: process.env.CLAUDE_ARGS ? (JSON.parse(process.env.CLAUDE_ARGS) as string[]) : undefined,
      skipPermissions: process.env.CLAUDE_SKIP_PERMISSIONS === 'true',
    }),
  [TTS_DRIVER_ID]: () =>
    createTtsDriver({
      pricePer1kUsd: Number(process.env.TTS_PRICE_PER_1K_USD ?? 0.002),
      failAtChunk: process.env.TTS_FAIL_AT ? Number(process.env.TTS_FAIL_AT) : undefined,
    }),
  [LLM_DRIVER_ID]: () => createLlmDriver(),
  [VIDEO_DRIVER_ID]: () =>
    createVideoDriver({
      width: Number(process.env.VIDEO_WIDTH ?? 640),
      height: Number(process.env.VIDEO_HEIGHT ?? 360),
      fps: Number(process.env.VIDEO_FPS ?? 25),
    }),
}

export function registerDriver(id: string, factory: DriverFactory): void {
  DRIVERS[id] = factory
}

export interface RunnerDeps {
  db: Database
  storage: Storage
  commands?: CommandRunner
  capabilitiesDir?: string
  env?: NodeJS.ProcessEnv
  workspaceRoot?: string
  credentialsKey?: string
  webhooks?: WebhookDispatchOptions
  push?: PushOptions
}

const PROVIDER_ENV: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  dashscope: ['DASHSCOPE_API_KEY', 'BAILIAN_API_KEY'],
  bailian: ['DASHSCOPE_API_KEY', 'BAILIAN_API_KEY'],
  openai: ['OPENAI_API_KEY', 'LLM_HTTP_TOKEN'],
  openrouter: ['OPENAI_API_KEY', 'LLM_HTTP_TOKEN'],
}

/** 先读进程环境，再按租户凭据补齐缺失的密钥名。 */
export async function resolveSecretEnv(
  deps: Pick<RunnerDeps, 'db' | 'env' | 'credentialsKey'>,
  tenantId: string,
  secretNames: string[],
): Promise<Record<string, string>> {
  const source = deps.env ?? process.env
  const env: Record<string, string> = {}
  for (const name of secretNames) {
    const value = source[name]
    if (value) env[name] = value
  }

  const missing = secretNames.filter((name) => !env[name])
  if (missing.length === 0) return env

  const credentials = await listModelCredentials(deps.db, tenantId)
  if (credentials.length === 0) return env

  const masterKey = deriveMasterKey(
    deps.credentialsKey ?? source.CREDENTIALS_KEY ?? source.AUTH_SECRET ?? 'dev-secret-change-me',
  )

  for (const credential of credentials) {
    const mapped = PROVIDER_ENV[credential.provider] ?? []
    for (const name of missing) {
      if (env[name] || !mapped.includes(name)) continue
      try {
        env[name] = decryptSecret(credential.encrypted_secret, masterKey)
        await touchModelCredential(deps.db, credential.id)
      } catch (error) {
        console.error(`凭据解密失败 provider=${credential.provider}`, error)
      }
    }
  }

  return env
}

interface Failure {
  code: string
  message: string
  retryable: boolean
}

const now = () => new Date().toISOString()

async function emit(
  db: Database,
  job: JobRow,
  event: JobEvent,
): Promise<void> {
  await appendJobEvent(db, job.tenant_id, job.id, event)
}

async function safeDispatch(
  deps: RunnerDeps,
  job: JobRow,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await dispatchJobWebhooks(deps.db, job, event, payload, deps.webhooks)
  } catch (error) {
    console.error('webhook 投递失败', error)
  }

  try {
    const succeeded = event === 'job.succeeded'
    await dispatchJobPush(
      deps.db,
      job,
      {
        title: succeeded ? '任务完成' : event === 'job.cancelled' ? '任务已取消' : '任务失败',
        body: `${job.capability_id} ${succeeded ? '已完成' : event === 'job.cancelled' ? '已取消' : '执行失败'}`,
        event,
      },
      deps.push,
    )
  } catch (error) {
    console.error('推送投递失败', error)
  }
}

async function downloadInputs(
  deps: RunnerDeps,
  job: JobRow,
  workspace: string,
): Promise<TaskContext['inputs']> {
  const inputs: TaskContext['inputs'] = []
  for (const ref of job.input_assets) {
    const detail = await getAssetVersionDetail(
      deps.db,
      job.tenant_id,
      ref.assetId,
      ref.version,
    )
    if (!detail) throw new Error(`输入资产不存在: ${ref.assetId}@${ref.version}`)
    const data = await deps.storage.get(detail.storage_key)
    const filename = basename(detail.name).replace(/[^A-Za-z0-9._-]/g, '_') || 'input.bin'
    const path = join(workspace, filename)
    await writeFile(path, data)
    inputs.push({
      assetId: ref.assetId,
      version: ref.version,
      type: detail.type as TaskContext['inputs'][number]['type'],
      path,
      mime: detail.mime,
    })
  }
  return inputs
}

async function finalize(
  deps: RunnerDeps,
  job: JobRow,
  driver: Driver,
  ctx: TaskContext,
): Promise<void> {
  const specs = await driver.collect(ctx)
  const outputs: { assetId: string; version: number; name: string; type: string }[] = []

  for (const spec of specs) {
    const data = await readFile(spec.path)
    const checksum = createHash('sha256').update(data).digest('hex')
    const size = data.byteLength
    const assetId = crypto.randomUUID()
    const version = 1
    const key = storageKeyFor(job.tenant_id, job.project_id, assetId, version, spec.name)
    await deps.storage.put(key, data, spec.mime)

    const asset = await createAsset(deps.db, {
      id: assetId,
      tenantId: job.tenant_id,
      projectId: job.project_id,
      type: spec.type,
      name: `${job.capability_id}.${spec.name}`,
      mime: spec.mime,
      sizeBytes: size,
      checksumSha256: checksum,
      storageKey: key,
      meta: spec.meta ?? {},
    })

    for (const input of job.input_assets) {
      await linkAssets(deps.db, {
        tenantId: job.tenant_id,
        projectId: job.project_id,
        fromAssetId: input.assetId,
        fromVersion: input.version,
        toAssetId: asset.id,
        toVersion: version,
        relation: 'derived_from',
      })
    }

    await insertJobArtifact(deps.db, {
      tenantId: job.tenant_id,
      jobId: job.id,
      assetId: asset.id,
      version,
      name: spec.name,
      type: spec.type,
      mime: spec.mime,
      sizeBytes: size,
    })

    outputs.push({ assetId: asset.id, version, name: asset.name, type: spec.type })
  }

  const cost = await sumJobUsage(deps.db, job.id)
  await setJobOutputs(deps.db, job.id, outputs, cost)
  await setJobStatus(deps.db, job.id, 'succeeded')
}

export interface RunResult {
  jobId: string
  status: JobRow['status']
  errorCode?: string
}

export async function runOnce(deps: RunnerDeps): Promise<RunResult | null> {
  const job = await claimNextJob(deps.db)
  if (!job) return null

  const workspaceRoot = deps.workspaceRoot ?? tmpdir()
  const workspace = join(workspaceRoot, `clouddeck-job-${job.id}`)
  const outputDir = join(workspace, 'output')
  await mkdir(outputDir, { recursive: true })

  let failure: Failure | null = null
  let cancelled = false
  let resumable = false
  let keepWorkspace = false

  try {
    const capability = await getCapability(deps.db, job.capability_id, job.capability_version)
    if (!capability) {
      failure = { code: 'CAPABILITY_UNAVAILABLE', message: '能力版本不存在', retryable: false }
      throw new Error(failure.message)
    }

    resumable = capability.manifest.execution.resumable
    const factory = DRIVERS[job.driver_id]
    if (!factory) {
      failure = { code: 'DRIVER_ERROR', message: `未注册的 driver: ${job.driver_id}`, retryable: false }
      throw new Error(failure.message)
    }

    const driver = factory()
    const inputs = await downloadInputs(deps, job, workspace)

    const capabilitiesDir = deps.capabilitiesDir ?? DEFAULT_CAPABILITIES_DIR
    const systemPromptPath = capability.manifest.prompts?.system
    let systemPrompt: string | undefined
    if (systemPromptPath) {
      try {
        systemPrompt = await readFile(
          join(capabilitiesDir, capability.id, systemPromptPath),
          'utf8',
        )
      } catch {
        systemPrompt = undefined
      }
    }

    const env = await resolveSecretEnv(
      deps,
      job.tenant_id,
      capability.manifest.permissions.secrets,
    )

    const commands = deps.commands ?? new LocalSandbox()

    const controller = new AbortController()
    let abortReason: 'CANCELLED' | 'TIMEOUT' | 'BUDGET_EXCEEDED' | null = null
    const stop = (reason: typeof abortReason) => {
      if (controller.signal.aborted) return
      abortReason = reason
      controller.abort()
    }

    const durationTimer = setTimeout(
      () => stop('TIMEOUT'),
      capability.manifest.execution.maxDurationMs,
    )
    const cancelTimer = setInterval(() => {
      void isCancelRequested(deps.db, job.id).then((requested) => {
        if (requested) stop('CANCELLED')
      })
    }, 250)

    const ctx: TaskContext = {
      jobId: job.id,
      tenantId: job.tenant_id,
      capability: {
        id: job.capability_id,
        version: job.capability_version,
        outputs: capability.manifest.outputs,
        ...(systemPrompt ? { systemPrompt } : {}),
      },
      params: job.params,
      inputs,
      workspace,
      outputDir,
      env,
      limits: {
        maxDurationMs: capability.manifest.execution.maxDurationMs,
        maxCostUsd: capability.manifest.execution.maxCostUsd,
        maxOutputBytes: 512 * 1024 * 1024,
      },
      signal: controller.signal,
      commands,
    }

    await setJobStatus(deps.db, job.id, 'running')
    await emit(deps.db, job, {
      type: 'log',
      level: 'info',
      message: `开始执行 ${job.capability_id}@${job.capability_version}`,
      at: now(),
    })

    await driver.submit(ctx)
    let budget = 0
    let streamEnded = false

    for await (const event of driver.events(ctx)) {
      if (abortReason) break

      if (event.type === 'usage') {
        budget += event.costUsd
        await insertUsage(deps.db, {
          tenantId: job.tenant_id,
          jobId: job.id,
          capabilityId: job.capability_id,
          driverId: job.driver_id,
          unit: capability.manifest.billing.unit,
          quantity: 1,
          unitPrice: event.costUsd,
          amountUsd: event.costUsd,
          period: periodOf(),
        })
        if (budget > ctx.limits.maxCostUsd) {
          stop('BUDGET_EXCEEDED')
        }
      }

      await emit(deps.db, job, event)

      if (event.type === 'error') {
        failure = { code: event.code, message: event.message, retryable: event.retryable }
        break
      }
      if (event.type === 'done') {
        streamEnded = true
        break
      }
    }

    clearTimeout(durationTimer)
    clearInterval(cancelTimer)

    if (abortReason) {
      await driver.cancel(ctx)
      if (abortReason === 'CANCELLED') {
        cancelled = true
      } else {
        failure = {
          code: abortReason,
          message: abortReason === 'TIMEOUT' ? '任务超时' : '任务超出预算',
          retryable: abortReason === 'TIMEOUT',
        }
      }
    } else if (failure?.code === 'CANCELLED') {
      cancelled = true
      failure = null
    } else if (!failure && streamEnded) {
      await finalize(deps, job, driver, ctx)
      await safeDispatch(deps, job, 'job.succeeded', { status: 'succeeded' })
      return { jobId: job.id, status: 'succeeded' }
    } else if (!failure) {
      failure = { code: 'DRIVER_ERROR', message: '驱动未返回 done 事件', retryable: true }
    }
  } catch (error) {
    if (!failure) {
      failure = {
        code: 'DRIVER_ERROR',
        message: error instanceof Error ? error.message : '未知错误',
        retryable: true,
      }
    }
    await emit(deps.db, job, {
      type: 'log',
      level: 'error',
      message: failure.message,
      at: now(),
    })
  } finally {
    keepWorkspace = resumable && (failure !== null || cancelled)
    if (!keepWorkspace) await rm(workspace, { recursive: true, force: true })
  }

  if (cancelled) {
    await setJobStatus(deps.db, job.id, 'cancelled')
    await emit(deps.db, job, { type: 'log', level: 'warn', message: '任务已取消', at: now() })
    await safeDispatch(deps, job, 'job.cancelled', { status: 'cancelled' })
    return { jobId: job.id, status: 'cancelled' }
  }

  const code = failure?.code ?? 'DRIVER_ERROR'
  const message = failure?.message ?? '任务失败'
  await setJobStatus(deps.db, job.id, 'failed', { errorCode: code, errorMessage: message })
  await emit(deps.db, job, {
    type: 'error',
    code,
    message,
    retryable: failure?.retryable ?? true,
    at: now(),
  })
  await safeDispatch(deps, job, 'job.failed', { status: 'failed', errorCode: code, errorMessage: message })
  return { jobId: job.id, status: 'failed', errorCode: code }
}

export interface WorkerOptions {
  pollIntervalMs?: number
}

export async function startWorker(
  deps: RunnerDeps,
  options: WorkerOptions = {},
): Promise<() => void> {
  const interval = options.pollIntervalMs ?? 500
  let stopped = false
  let timer: NodeJS.Timeout | null = null

  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      const result = await runOnce(deps)
      if (!result) {
        timer = setTimeout(() => void tick(), interval)
        return
      }
    } catch (error) {
      console.error('job-runner 执行失败', error)
    }
    if (!stopped) timer = setTimeout(() => void tick(), 10)
  }

  void tick()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
