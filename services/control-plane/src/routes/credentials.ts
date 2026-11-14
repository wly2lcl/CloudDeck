import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createModelCredential,
  deleteModelCredential,
  listModelCredentials,
  withTenant,
  type ModelCredentialRow,
} from '@clouddeck/db'
import { decryptSecret, deriveMasterKey, encryptSecret, keyHint } from '@clouddeck/secrets'
import { requireAuth, requireRole } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const createSchema = z.object({
  provider: z.enum(['anthropic', 'dashscope', 'bailian', 'openai', 'openrouter', 'custom']),
  label: z.string().min(1).max(80),
  secret: z.string().min(8).max(4096),
})

function serializeCredential(row: ModelCredentialRow) {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    keyHint: row.key_hint,
    status: row.status,
    createdAt: toIso(row.created_at),
  }
}

export function registerCredentialRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/model-credentials', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const credentials = await withTenant(deps.db, auth.tenantId, (tx) =>
      listModelCredentials(tx, auth.tenantId),
    )
    return ok(request, credentials.map(serializeCredential))
  })

  app.post('/v1/model-credentials', { preHandler: guard }, async (request, reply) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const body = parseBody(createSchema, request.body)
    const masterKey = deriveMasterKey(deps.config.credentialsKey)
    const credential = await withTenant(deps.db, auth.tenantId, (tx) =>
      createModelCredential(tx, {
        tenantId: auth.tenantId,
        provider: body.provider,
        label: body.label,
        encryptedSecret: encryptSecret(body.secret, masterKey),
        keyHint: keyHint(body.secret),
      }),
    )
    reply.status(201)
    return ok(request, serializeCredential(credential))
  })

  app.delete('/v1/model-credentials/:id', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const deleted = await withTenant(deps.db, auth.tenantId, (tx) =>
      deleteModelCredential(tx, auth.tenantId, param(request, 'id')),
    )
    if (!deleted) throw new AppError('NOT_FOUND', '凭据不存在')
    return ok(request, { deleted: true })
  })

  // 仅用于本地验证解密链路，返回脱敏信息，不返回明文。
  app.get('/v1/model-credentials/:id/verify', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const credentials = await withTenant(deps.db, auth.tenantId, (tx) =>
      listModelCredentials(tx, auth.tenantId),
    )
    const credential = credentials.find((item) => item.id === param(request, 'id'))
    if (!credential) throw new AppError('NOT_FOUND', '凭据不存在')

    try {
      const plaintext = decryptSecret(
        credential.encrypted_secret,
        deriveMasterKey(deps.config.credentialsKey),
      )
      return ok(request, { id: credential.id, ok: plaintext.length > 0 })
    } catch {
      return ok(request, { id: credential.id, ok: false })
    }
  })
}
