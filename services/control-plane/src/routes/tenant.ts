import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  getTenant,
  listCapabilities,
  listTenantCapabilityStates,
  setTenantCapability,
  updateTenantPlan,
  type TenantTier,
} from '@clouddeck/db'
import { requireAuth, requireRole } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const planSchema = z.object({ tier: z.enum(['free', 'pro', 'team']) })
const toggleSchema = z.object({ enabled: z.boolean() })

function serializeTenant(tenant: NonNullable<Awaited<ReturnType<typeof getTenant>>>) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    tier: tenant.tier,
    status: tenant.status,
    createdAt: toIso(tenant.created_at),
  }
}

export function registerTenantRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/tenant', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const tenant = await getTenant(deps.db, auth.tenantId)
    if (!tenant) throw new AppError('NOT_FOUND', '租户不存在')
    return ok(request, { ...serializeTenant(tenant), role: auth.role })
  })

  app.patch('/v1/tenant', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const body = parseBody(planSchema, request.body)
    const tenant = await updateTenantPlan(deps.db, auth.tenantId, body.tier as TenantTier)
    if (!tenant) throw new AppError('NOT_FOUND', '租户不存在')
    return ok(request, serializeTenant(tenant))
  })

  app.get('/v1/capabilities/states', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const [capabilities, states] = await Promise.all([
      listCapabilities(deps.db),
      listTenantCapabilityStates(deps.db, auth.tenantId),
    ])
    const enabled = new Map(states.map((state) => [state.capability_id, state.enabled]))
    return ok(
      request,
      capabilities.map((capability) => ({
        id: capability.id,
        name: capability.name,
        category: capability.category,
        enabled: enabled.get(capability.id) ?? true,
      })),
    )
  })

  app.put('/v1/capabilities/:id/enabled', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const body = parseBody(toggleSchema, request.body)
    await setTenantCapability(deps.db, auth.tenantId, param(request, 'id'), body.enabled)
    return ok(request, { id: param(request, 'id'), enabled: body.enabled })
  })
}
