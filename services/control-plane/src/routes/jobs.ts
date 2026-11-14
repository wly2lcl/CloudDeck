import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AssetType, CapabilityManifest } from '@clouddeck/contracts'
import {
  billingReconciliation,
  createInvoice,
  createJob,
  getAsset,
  getCapability,
  getInvoice,
  getJob,
  getProject,
  getQuotaSnapshot,
  getUsageSummary,
  incrementQuotaJobs,
  isCapabilityEnabled,
  listInvoices,
  usageBreakdown,
  listJobEvents,
  listJobs,
  periodOf,
  requestCancel,
  resumeJob,
  retryJob,
  withTenant,
  type JobRow,
} from '@clouddeck/db'
import { requireAuth, requireRole } from '../auth'
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

export function serializeJob(row: JobRow, resumable = false) {
  return {
    resumable,
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
      if (!(await isCapabilityEnabled(tx, auth.tenantId, capability.id))) {
        throw new AppError('CAPABILITY_UNAVAILABLE', '该能力已被租户停用')
      }

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
    return ok(request, jobs.map((job) => serializeJob(job)))
  })

  app.get('/v1/jobs/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const result = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const job = await getJob(tx, auth.tenantId, param(request, 'id'))
      if (!job) return null
      const capability = await getCapability(tx, job.capability_id, job.capability_version)
      return { job, resumable: capability?.manifest.execution.resumable ?? false }
    })
    if (!result) throw new AppError('NOT_FOUND', '任务不存在')
    return ok(request, serializeJob(result.job, result.resumable))
  })

  app.post('/v1/jobs/:id/cancel', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const job = await withTenant(deps.db, auth.tenantId, (tx) =>
      requestCancel(tx, auth.tenantId, param(request, 'id')),
    )
    if (!job) throw new AppError('NOT_FOUND', '任务不存在或已结束')
    return ok(request, serializeJob(job))
  })

  app.post('/v1/jobs/:id/resume', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const job = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const existing = await getJob(tx, auth.tenantId, param(request, 'id'))
      if (!existing) throw new AppError('NOT_FOUND', '任务不存在')
      const capability = await getCapability(
        tx,
        existing.capability_id,
        existing.capability_version,
      )
      if (!capability?.manifest.execution.resumable) {
        throw new AppError('VALIDATION_FAILED', '该能力不支持续作')
      }
      const resumed = await resumeJob(tx, auth.tenantId, existing.id)
      if (!resumed) throw new AppError('NOT_FOUND', '任务当前状态不可续作')
      return resumed
    })
    return ok(request, serializeJob(job, true))
  })

  app.post('/v1/jobs/:id/retry', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const job = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const retried = await retryJob(tx, auth.tenantId, param(request, 'id'))
      if (!retried) throw new AppError('NOT_FOUND', '任务不存在或不可重试')
      await incrementQuotaJobs(tx, auth.tenantId, periodOf())
      return retried
    })
    reply.status(201)
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

  app.get('/v1/billing/statement', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const period = queryString(request, 'period') ?? periodOf()
    const result = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const items = await usageBreakdown(tx, auth.tenantId, period)
      const usage = await getUsageSummary(tx, auth.tenantId, period)
      return { items, usage }
    })
    const totalUsd = result.items.reduce((sum, item) => sum + Number(item.amount_usd), 0)
    return ok(request, {
      period,
      generatedAt: new Date().toISOString(),
      totalUsd: Number(totalUsd.toFixed(4)),
      jobCount: result.usage.job_count,
      items: result.items.map((row) => ({
        capabilityId: row.capability_id,
        driverId: row.driver_id,
        unit: row.unit,
        quantity: Number(row.quantity),
        amountUsd: Number(row.amount_usd),
        entries: row.entries,
      })),
    })
  })

  app.get('/v1/billing/reconciliation', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const period = queryString(request, 'period') ?? periodOf()
    const rows = await withTenant(deps.db, auth.tenantId, (tx) =>
      billingReconciliation(tx, auth.tenantId, period),
    )

    const jobs = rows.map((row) => {
      const estimated = Number(row.estimated_cost_usd)
      const actual = Number(row.usage_usd)
      return {
        jobId: row.job_id,
        capabilityId: row.capability_id,
        status: row.status,
        estimatedCostUsd: estimated,
        actualCostUsd: actual,
        varianceUsd: Number((actual - estimated).toFixed(4)),
      }
    })

    return ok(request, {
      period,
      jobs,
      totals: {
        estimatedCostUsd: Number(jobs.reduce((sum, job) => sum + job.estimatedCostUsd, 0).toFixed(4)),
        actualCostUsd: Number(jobs.reduce((sum, job) => sum + job.actualCostUsd, 0).toFixed(4)),
      },
    })
  })

  app.post('/v1/billing/invoices', { preHandler: guard }, async (request, reply) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const period = queryString(request, 'period') ?? periodOf()
    const result = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const items = await usageBreakdown(tx, auth.tenantId, period)
      const usage = await getUsageSummary(tx, auth.tenantId, period)
      const totalUsd = items.reduce((sum, item) => sum + Number(item.amount_usd), 0)
      const snapshot = {
        generatedAt: new Date().toISOString(),
        items: items.map((row) => ({
          capabilityId: row.capability_id,
          driverId: row.driver_id,
          unit: row.unit,
          quantity: Number(row.quantity),
          amountUsd: Number(row.amount_usd),
          entries: row.entries,
        })),
      }
      return createInvoice(tx, {
        tenantId: auth.tenantId,
        period,
        totalUsd: Number(totalUsd.toFixed(4)),
        jobCount: usage.job_count,
        snapshot,
      })
    })

    reply.status(result.created ? 201 : 200)
    const invoice = result.invoice
    return ok(request, {
      id: invoice.id,
      period: invoice.period,
      totalUsd: Number(invoice.total_usd),
      jobCount: invoice.job_count,
      status: invoice.status,
      createdAt: toIso(invoice.created_at),
      snapshot: invoice.snapshot,
    })
  })

  app.get('/v1/billing/invoices', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const invoices = await withTenant(deps.db, auth.tenantId, (tx) =>
      listInvoices(tx, auth.tenantId),
    )
    return ok(
      request,
      invoices.map((invoice) => ({
        id: invoice.id,
        period: invoice.period,
        totalUsd: Number(invoice.total_usd),
        jobCount: invoice.job_count,
        status: invoice.status,
        createdAt: toIso(invoice.created_at),
      })),
    )
  })

  app.get('/v1/billing/invoices/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const invoice = await withTenant(deps.db, auth.tenantId, (tx) =>
      getInvoice(tx, auth.tenantId, param(request, 'id')),
    )
    if (!invoice) throw new AppError('NOT_FOUND', '账单不存在')
    return ok(request, {
      id: invoice.id,
      period: invoice.period,
      totalUsd: Number(invoice.total_usd),
      jobCount: invoice.job_count,
      status: invoice.status,
      createdAt: toIso(invoice.created_at),
      snapshot: invoice.snapshot,
    })
  })

  app.get('/v1/billing/invoices/:id/html', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const invoice = await withTenant(deps.db, auth.tenantId, (tx) =>
      getInvoice(tx, auth.tenantId, param(request, 'id')),
    )
    if (!invoice) throw new AppError('NOT_FOUND', '账单不存在')

    const snapshot = invoice.snapshot as {
      items?: { capabilityId: string; driverId: string; quantity: number; amountUsd: number }[]
    }
    const escape = (value: unknown) =>
      String(value).replace(/[&<>"']/g, (char) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
      )
    const rows = (snapshot.items ?? [])
      .map(
        (item) =>
          `<tr><td>${escape(item.capabilityId)}</td><td>${escape(item.driverId)}</td><td>${escape(item.quantity)}</td><td>${escape(item.amountUsd)}</td></tr>`,
      )
      .join('')

    reply.type('text/html; charset=utf-8')
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>账单 ${escape(invoice.period)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}</style>
</head><body>
<h1>CloudDeck 月度账单</h1>
<p>账期：${escape(invoice.period)} · 任务数：${invoice.job_count} · 状态：${escape(invoice.status)}</p>
<table><thead><tr><th>能力</th><th>驱动</th><th>数量</th><th>金额（USD）</th></tr></thead><tbody>${rows}</tbody></table>
<p style="margin-top:24px"><strong>合计：${Number(invoice.total_usd).toFixed(4)} USD</strong></p>
<p style="color:#666">本页可直接打印为 PDF；税务发票需通过合规开票服务生成。</p>
</body></html>`
  })

  app.get('/v1/billing/summary', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const period = queryString(request, 'period') ?? periodOf()
    const rows = await withTenant(deps.db, auth.tenantId, (tx) =>
      usageBreakdown(tx, auth.tenantId, period),
    )
    return ok(request, {
      period,
      items: rows.map((row) => ({
        capabilityId: row.capability_id,
        driverId: row.driver_id,
        unit: row.unit,
        quantity: Number(row.quantity),
        amountUsd: Number(row.amount_usd),
        entries: row.entries,
      })),
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
