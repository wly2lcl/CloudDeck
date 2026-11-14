import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  withTenant,
} from '@clouddeck/db'
import { requireAuth } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).default([]),
})

export function registerWebhookRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/webhooks', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const hooks = await withTenant(deps.db, auth.tenantId, (tx) =>
      listWebhooks(tx, auth.tenantId),
    )
    return ok(
      request,
      hooks.map((hook) => ({
        id: hook.id,
        url: hook.url,
        events: hook.events,
        enabled: hook.enabled,
        createdAt: toIso(hook.created_at),
      })),
    )
  })

  app.post('/v1/webhooks', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = parseBody(createSchema, request.body)
    const secret = randomBytes(24).toString('hex')
    const hook = await withTenant(deps.db, auth.tenantId, (tx) =>
      createWebhook(tx, {
        tenantId: auth.tenantId,
        url: body.url,
        secret,
        events: body.events,
      }),
    )
    reply.status(201)
    return ok(request, {
      id: hook.id,
      url: hook.url,
      events: hook.events,
      enabled: hook.enabled,
      secret,
      createdAt: toIso(hook.created_at),
    })
  })

  app.delete('/v1/webhooks/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const deleted = await withTenant(deps.db, auth.tenantId, (tx) =>
      deleteWebhook(tx, auth.tenantId, param(request, 'id')),
    )
    if (!deleted) throw new AppError('NOT_FOUND', 'Webhook 不存在')
    return ok(request, { deleted: true })
  })

  app.get('/v1/webhook-deliveries', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const deliveries = await withTenant(deps.db, auth.tenantId, (tx) =>
      listWebhookDeliveries(tx, auth.tenantId),
    )
    return ok(
      request,
      deliveries.map((delivery) => ({
        id: delivery.id,
        webhookId: delivery.webhook_id,
        event: delivery.event,
        status: delivery.status,
        attempts: delivery.attempts,
        lastError: delivery.last_error,
        createdAt: toIso(delivery.created_at),
        deliveredAt: delivery.delivered_at ? toIso(delivery.delivered_at) : null,
      })),
    )
  })
}
