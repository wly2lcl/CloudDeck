import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  findUserById,
  getQuotaSnapshot,
  listAllTenants,
  listJobs,
  periodOf,
  setGlobalCapabilityEnabled,
  updateQuotaLimits,
  updateTenantPlan,
  withTenant,
  type TenantTier,
} from '@clouddeck/db'
import { audit } from '../audit'
import { requireAuth } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody, queryString } from './helpers'

const planSchema = z.object({ tier: z.enum(['free', 'pro', 'team']) })
const quotaSchema = z.object({
  maxCostUsd: z.number().positive(),
  maxJobs: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
})
const capabilitySchema = z.object({ enabled: z.boolean() })

async function requireAdmin(request: FastifyRequest, deps: AppDeps) {
  const auth = requireAuth(request)
  const user = await findUserById(deps.db, auth.userId)
  if (!user || !deps.config.platformAdminEmails.includes(user.email.toLowerCase())) {
    throw new AppError('FORBIDDEN', '需要平台管理员权限')
  }
  return auth
}

export function registerAdminRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/admin/tenants', { preHandler: guard }, async (request) => {
    await requireAdmin(request, deps)
    const period = periodOf()
    const tenants = await listAllTenants(deps.db)
    const result = []
    for (const tenant of tenants) {
      const quota = await withTenant(deps.db, tenant.id, (tx) =>
        getQuotaSnapshot(tx, tenant.id, period),
      ).catch(() => null)
      result.push({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        tier: tenant.tier,
        createdAt: toIso(tenant.created_at),
        quota: quota
          ? {
              maxCostUsd: Number(quota.max_cost_usd),
              maxJobs: quota.max_jobs,
              maxConcurrency: quota.max_concurrency,
              costUsd: Number(quota.cost_usd),
              reservedCostUsd: Number(quota.reserved_cost_usd),
              jobCount: quota.job_count,
              running: quota.running,
            }
          : null,
      })
    }
    return ok(request, result)
  })

  app.patch('/v1/admin/tenants/:id/plan', { preHandler: guard }, async (request) => {
    const auth = await requireAdmin(request, deps)
    const tenantId = param(request, 'id')
    const body = parseBody(planSchema, request.body)
    const tenant = await withTenant(deps.db, tenantId, (tx) =>
      updateTenantPlan(tx, tenantId, body.tier as TenantTier),
    )
    if (!tenant) throw new AppError('NOT_FOUND', '租户不存在')
    await audit(deps.db, {
      tenantId,
      actorType: 'platform_admin',
      actorId: auth.userId,
      action: 'admin.plan',
      targetType: 'tenant',
      targetId: tenantId,
      ip: request.ip,
      detail: { tier: body.tier },
    })
    return ok(request, { id: tenantId, tier: tenant.tier })
  })

  app.patch('/v1/admin/tenants/:id/quota', { preHandler: guard }, async (request) => {
    const auth = await requireAdmin(request, deps)
    const tenantId = param(request, 'id')
    const body = parseBody(quotaSchema, request.body)
    await withTenant(deps.db, tenantId, (tx) =>
      updateQuotaLimits(tx, tenantId, {
        maxCostUsd: body.maxCostUsd,
        maxJobs: body.maxJobs,
        maxConcurrency: body.maxConcurrency,
      }),
    )
    await audit(deps.db, {
      tenantId,
      actorType: 'platform_admin',
      actorId: auth.userId,
      action: 'admin.quota',
      targetType: 'tenant',
      targetId: tenantId,
      ip: request.ip,
      detail: body,
    })
    return ok(request, { id: tenantId, ...body })
  })

  app.patch('/v1/admin/capabilities/:id', { preHandler: guard }, async (request) => {
    const auth = await requireAdmin(request, deps)
    const capabilityId = param(request, 'id')
    const body = parseBody(capabilitySchema, request.body)
    const updated = await setGlobalCapabilityEnabled(deps.db, capabilityId, body.enabled)
    if (!updated) throw new AppError('NOT_FOUND', '能力不存在')
    await audit(deps.db, {
      tenantId: auth.tenantId,
      actorType: 'platform_admin',
      actorId: auth.userId,
      action: 'admin.capability',
      targetType: 'capability',
      targetId: capabilityId,
      ip: request.ip,
      detail: { enabled: body.enabled },
    })
    return ok(request, { id: capabilityId, enabled: body.enabled })
  })

  app.get('/v1/admin/jobs', { preHandler: guard }, async (request) => {
    await requireAdmin(request, deps)
    const status = queryString(request, 'status')
    const limit = Math.min(Number(queryString(request, 'limit') ?? 100), 500)
    const tenants = await listAllTenants(deps.db)
    const jobs = []
    for (const tenant of tenants) {
      const items = await withTenant(deps.db, tenant.id, (tx) =>
        listJobs(tx, tenant.id),
      ).catch(() => [])
      for (const job of items) {
        if (status && job.status !== status) continue
        jobs.push({
          id: job.id,
          tenantId: tenant.id,
          tenantName: tenant.name,
          capabilityId: job.capability_id,
          status: job.status,
          estimatedCostUsd: Number(job.estimated_cost_usd),
          actualCostUsd: Number(job.actual_cost_usd),
          createdAt: toIso(job.created_at),
          finishedAt: job.finished_at ? toIso(job.finished_at) : null,
        })
      }
    }
    jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return ok(request, jobs.slice(0, Number.isFinite(limit) ? limit : 100))
  })
}
