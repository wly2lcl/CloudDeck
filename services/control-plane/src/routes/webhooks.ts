import { createHmac, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createWebhook,
  deleteWebhook,
  finishWebhookDelivery,
  getWebhook,
  getWebhookDelivery,
  listWebhookDeliveries,
  listWebhooks,
  withTenant,
} from '@clouddeck/db'
import { audit } from '../audit'
import { requireAuth, requireRole } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).default([]),
})

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

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

  app.post('/v1/webhook-deliveries/:id/replay', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const deliveryId = param(request, 'id')
    const result = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const delivery = await getWebhookDelivery(tx, auth.tenantId, deliveryId)
      if (!delivery) throw new AppError('NOT_FOUND', '投递记录不存在')
      const hook = await getWebhook(tx, auth.tenantId, delivery.webhook_id)
      if (!hook) throw new AppError('NOT_FOUND', 'Webhook 已被删除')

      const body = JSON.stringify({ event: delivery.event, ...delivery.payload })
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const signature = sign(hook.secret, timestamp, body)
      let delivered = false
      let statusCode: number | null = null
      let lastError: string | null = null
      try {
        const response = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-clouddeck-event': delivery.event,
            'x-clouddeck-timestamp': timestamp,
            'x-clouddeck-signature': signature,
          },
          body,
        })
        statusCode = response.status
        delivered = response.ok
        if (!delivered) lastError = `HTTP ${response.status}`
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }

      await finishWebhookDelivery(tx, {
        deliveryId: delivery.id,
        status: delivered ? 'delivered' : 'failed',
        attempts: delivery.attempts + 1,
        lastError,
      })
      return { delivered, statusCode, lastError }
    })

    await audit(deps.db, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'webhook.replay',
      targetType: 'webhook_delivery',
      targetId: deliveryId,
      ip: request.ip,
      detail: { delivered: result.delivered },
    })
    return ok(request, result)
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
