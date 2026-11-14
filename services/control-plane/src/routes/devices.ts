import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  deleteDeviceToken,
  upsertDeviceToken,
  withTenant,
} from '@clouddeck/db'
import { requireAuth } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const registerSchema = z.object({
  platform: z.enum(['android', 'ios', 'web']),
  token: z.string().min(16).max(4096),
})

export function registerDeviceRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.post('/v1/devices', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = parseBody(registerSchema, request.body)
    const device = await withTenant(deps.db, auth.tenantId, (tx) =>
      upsertDeviceToken(tx, {
        tenantId: auth.tenantId,
        userId: auth.userId,
        platform: body.platform,
        token: body.token,
      }),
    )
    reply.status(201)
    return ok(request, {
      id: device.id,
      platform: device.platform,
      token: device.token,
      createdAt: toIso(device.created_at),
    })
  })

  app.delete('/v1/devices/:token', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const deleted = await withTenant(deps.db, auth.tenantId, (tx) =>
      deleteDeviceToken(tx, auth.tenantId, param(request, 'token')),
    )
    if (!deleted) throw new AppError('NOT_FOUND', '设备不存在')
    return ok(request, { deleted: true })
  })
}
