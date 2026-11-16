import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  withTenant,
} from '@clouddeck/db'
import { audit } from '../audit'
import { hashToken, requireRole } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const createSchema = z.object({
  name: z.string().min(1).max(64),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
})

function masked(row: { key_hint: string }): string {
  return `cdk_…${row.key_hint}`
}

export function registerApiKeyRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.post('/v1/api-keys', { preHandler: guard }, async (request, reply) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const body = parseBody(createSchema, request.body)
    const token = `cdk_${randomBytes(32).toString('hex')}`
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null

    const created = await withTenant(deps.db, auth.tenantId, (tx) =>
      createApiKey(tx, {
        tenantId: auth.tenantId,
        name: body.name,
        keyHash: hashToken(token),
        keyHint: token.slice(-6),
        scopes: ['*'],
        createdBy: auth.userId,
        expiresAt,
      }),
    )
    await audit(deps.db, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'api_key.create',
      targetType: 'api_key',
      targetId: created.id,
      ip: request.ip,
      detail: { name: body.name },
    })

    reply.status(201)
    return ok(request, {
      id: created.id,
      name: created.name,
      key: token,
      hint: masked(created),
      expiresAt: created.expires_at ? toIso(created.expires_at) : null,
      createdAt: toIso(created.created_at),
    })
  })

  app.get('/v1/api-keys', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const keys = await withTenant(deps.db, auth.tenantId, (tx) =>
      listApiKeys(tx, auth.tenantId),
    )
    return ok(
      request,
      keys.map((key) => ({
        id: key.id,
        name: key.name,
        hint: masked(key),
        scopes: key.scopes,
        lastUsedAt: key.last_used_at ? toIso(key.last_used_at) : null,
        expiresAt: key.expires_at ? toIso(key.expires_at) : null,
        createdAt: toIso(key.created_at),
      })),
    )
  })

  app.delete('/v1/api-keys/:id', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const keyId = param(request, 'id')
    const revoked = await withTenant(deps.db, auth.tenantId, (tx) =>
      revokeApiKey(tx, auth.tenantId, keyId),
    )
    if (!revoked) throw new AppError('NOT_FOUND', 'API Key 不存在或已撤销')
    await audit(deps.db, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'api_key.revoke',
      targetType: 'api_key',
      targetId: keyId,
      ip: request.ip,
    })
    return ok(request, { revoked: true })
  })
}
