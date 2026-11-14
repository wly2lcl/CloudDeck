import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AssetType, CapabilityManifest } from '@clouddeck/contracts'
import {
  createJob,
  getAsset,
  getCapability,
  getJob,
  getProject,
  getQuotaSnapshot,
  getUsageSummary,
  incrementQuotaJobs,
  listJobEvents,
  listJobs,
  periodOf,
  requestCancel,
  withTenant,
  type JobRow,
} from '@clouddeck/db'
import { requireAuth } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody, queryString, sleep, terminalStatuses } from './helpers'

const createJobSchema = z.object({
  capabilityId: z.string().min(1),
  capabilityVersion: z.string().min(1).optional(),
  inputs: z
    .array(z.object({ assetId: z.string().uuid(), version: z.number().int().positive() }))
    .default([]),
  params: z.record(z.string(), z.unknown()).default({}),
})

function resolveDriver(manifest: CapabilityManifest): string {
  const context: Record<string, unknown> = {}
  for (const rule of manifest.driver.routing) {
    if (!rule.when) return rule.driver
    const matches = Object.entries(rule.when).every(([key, value]) => context[key] === value)
    if (matches) return rule.driver
  }
  return manifest.driver.ref
}

export function serializeJob(row: JobRow) {
  return {
    jobId: row.id,
    projectId: row.project_id,
    capabilityId: row.capability_id,
    capabilityVersion: row.capability_version,
    status: row.status,
    driverId: row.driver_id,
    params: row.params,
    inputs: row.input_assets,
    outputs: row.output_assets,
    estimatedCostUsd: Number(row.estimated_cost_usd),
    actualCostUsd: Number(row.actual_cost_usd),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    cancelRequested: row.cancel_requested,
    createdAt: toIso(row.created_at),
    startedAt: row.started_at ? toIso(row.started_at) : null,
    finishedAt: row.finished_at ? toIso(row.finished_at) : null,
  }
}

export function registerJobRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.post('/v1/projects/:id/jobs', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const projectId = param(request, 'id')
    const body = parseBody(createJobSchema, request.body)

    const job = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const project = await getProject(tx, auth.tenantId, projectId)
      if (!project) throw new AppError('NOT_FOUND', '项目不存在')

      const capability = await getCapability(tx, body.capabilityId, body.capabilityVersion)
      if (!capability) throw new AppError('CAPABILITY_UNAVAILABLE', '能力不存在或已停用')

      const resolvedInputs: { assetId: string; version: number; type: AssetType }[] = []
      for (const ref of body.inputs) {
        const asset = await getAsset(tx, auth.tenantId, ref.assetId)
        if (!asset || asset.project_id !== projectId) {
          throw new AppError('VALIDATION_FAILED', `输入资产不存在: ${ref.assetId}`)
        }
        if (!capability.manifest.inputs.some((spec) => spec.assetTypes.includes(asset.type as AssetType))) {
          throw new AppError('VALIDATION_FAILED', `资产类型 ${asset.type} 不是该能力的输入`)
        }
        resolvedInputs.push({ assetId: asset.id, version: ref.version, type: asset.type as AssetType })
      }

      for (const spec of capability.manifest.inputs) {
        if (!spec.required) continue
        const present = resolvedInputs.some((input) => spec.assetTypes.includes(input.type))
        if (!present) {
          throw new AppError('VALIDATION_FAILED', `缺少必需输入: ${spec.label ?? spec.name}`)
        }
      }

      const period = periodOf()
      const quota = await getQuotaSnapshot(tx, auth.tenantId, period)
      if (!quota) throw new AppError('QUOTA_EXCEEDED', '租户配额未初始化')
      const estimate = capability.manifest.billing.estimate
      if (Number(quota.cost_usd) + estimate > Number(quota.max_cost_usd)) {
        throw new AppError('QUOTA_EXCEEDED', '本月额度不足')
      }
      if (quota.job_count >= quota.max_jobs) {
        throw new AppError('QUOTA_EXCEEDED', '本月任务数已达上限')
      }
      if (quota.running >= quota.max_concurrency) {
        throw new AppError('QUOTA_EXCEEDED', '并发任务已达上限')
      }

      const created = await createJob(tx, {
        tenantId: auth.tenantId,
        projectId,
        capabilityId: capability.id,
        capabilityVersion: capability.version,
        driverId: resolveDriver(capability.manifest),
        params: body.params,
        inputAssets: resolvedInputs.map(({ assetId, version }) => ({ assetId, version })),
        estimatedCostUsd: estimate,
        createdBy: auth.userId,
      })
      await incrementQuotaJobs(tx, auth.tenantId, period)
      return created
    })

    reply.status(201)
    return ok(request, serializeJob(job))
  })

  app.get('/v1/jobs', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const projectId = queryString(request, 'projectId')
    const jobs = await withTenant(deps.db, auth.tenantId, (tx) =>
      listJobs(tx, auth.tenantId, projectId),
    )
    return ok(request, jobs.map(serializeJob))
  })

  app.get('/v1/jobs/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const job = await withTenant(deps.db, auth.tenantId, (tx) =>
      getJob(tx, auth.tenantId, param(request, 'id')),
    )
    if (!job) throw new AppError('NOT_FOUND', '任务不存在')
    return ok(request, serializeJob(job))
  })

  app.post('/v1/jobs/:id/cancel', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const job = await withTenant(deps.db, auth.tenantId, (tx) =>
      requestCancel(tx, auth.tenantId, param(request, 'id')),
    )
    if (!job) throw new AppError('NOT_FOUND', '任务不存在或已结束')
    return ok(request, serializeJob(job))
  })

  app.get('/v1/jobs/:id/logs', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const jobId = param(request, 'id')
    const job = await withTenant(deps.db, auth.tenantId, (tx) =>
      getJob(tx, auth.tenantId, jobId),
    )
    if (!job) throw new AppError('NOT_FOUND', '任务不存在')
    const events = await withTenant(deps.db, auth.tenantId, (tx) =>
      listJobEvents(tx, jobId, 0, 1000),
    )
    return ok(
      request,
      events.map((event) => ({
        seq: event.seq,
        type: event.type,
        at: toIso(event.at),
        payload: event.payload,
      })),
    )
  })

  app.get('/v1/jobs/:id/events', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const jobId = param(request, 'id')
    const job = await withTenant(deps.db, auth.tenantId, (tx) =>
      getJob(tx, auth.tenantId, jobId),
    )
    if (!job) throw new AppError('NOT_FOUND', '任务不存在')

    const headerSeq = Number(request.headers['last-event-id'] ?? 0)
    const querySeq = Number(queryString(request, 'after') ?? 0)
    let lastSeq = Number.isFinite(headerSeq) && headerSeq > 0 ? headerSeq : querySeq
    if (!Number.isFinite(lastSeq) || lastSeq < 0) lastSeq = 0

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })

    let closed = false
    request.raw.on('close', () => {
      closed = true
    })

    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write('event: ping\ndata: {}\n\n')
    }, 15000)

    try {
      while (!closed) {
        const events = await withTenant(deps.db, auth.tenantId, (tx) =>
          listJobEvents(tx, jobId, lastSeq, 200),
        )
        for (const event of events) {
          lastSeq = event.seq
          reply.raw.write(
            `id: ${event.seq}\nevent: job.event\ndata: ${JSON.stringify({
              seq: event.seq,
              ...event.payload,
            })}\n\n`,
          )
        }

        const current = await withTenant(deps.db, auth.tenantId, (tx) =>
          getJob(tx, auth.tenantId, jobId),
        )
        if (!current) break
        if (terminalStatuses.has(current.status) && events.length === 0) {
          reply.raw.write(
            `event: job.end\ndata: ${JSON.stringify({ status: current.status })}\n\n`,
          )
          break
        }
        if (events.length === 0) await sleep(300)
      }
    } finally {
      clearInterval(heartbeat)
      reply.raw.end()
    }
  })

  app.get('/v1/billing/quota', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const snapshot = await withTenant(deps.db, auth.tenantId, (tx) =>
      getQuotaSnapshot(tx, auth.tenantId, periodOf()),
    )
    if (!snapshot) throw new AppError('NOT_FOUND', '配额未初始化')
    return ok(request, {
      period: periodOf(),
      maxCostUsd: Number(snapshot.max_cost_usd),
      maxJobs: snapshot.max_jobs,
      maxConcurrency: snapshot.max_concurrency,
      costUsd: Number(snapshot.cost_usd),
      jobCount: snapshot.job_count,
      running: snapshot.running,
    })
  })

  app.get('/v1/billing/usage', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const period = queryString(request, 'period') ?? periodOf()
    const usage = await withTenant(deps.db, auth.tenantId, (tx) =>
      getUsageSummary(tx, auth.tenantId, period),
    )
    return ok(request, {
      period,
      costUsd: Number(usage.cost_usd),
      jobCount: usage.job_count,
    })
  })
}
