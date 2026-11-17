import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createVoiceProfile,
  deleteVoiceProfile,
  listVoiceProfiles,
  withTenant,
} from '@clouddeck/db'
import { audit } from '../audit'
import { requireAuth, requireRole } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const createSchema = z.object({
  name: z.string().min(1).max(64),
  provider: z.string().min(1).max(32).default('dashscope'),
  voiceId: z.string().min(1).max(128),
  roleMap: z.record(z.string(), z.string()).default({}),
  description: z.string().max(500).optional(),
})

function serialize(profile: {
  id: string
  name: string
  provider: string
  voice_id: string
  role_map: Record<string, string>
  description: string | null
  created_at: Date
}) {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    voiceId: profile.voice_id,
    roleMap: profile.role_map,
    description: profile.description,
    createdAt: toIso(profile.created_at),
  }
}

export function registerVoiceProfileRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/voice-profiles', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const profiles = await withTenant(deps.db, auth.tenantId, (tx) =>
      listVoiceProfiles(tx, auth.tenantId),
    )
    return ok(request, profiles.map(serialize))
  })

  app.post('/v1/voice-profiles', { preHandler: guard }, async (request, reply) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const body = parseBody(createSchema, request.body)
    const profile = await withTenant(deps.db, auth.tenantId, (tx) =>
      createVoiceProfile(tx, { tenantId: auth.tenantId, ...body }),
    )
    await audit(deps.db, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'voice_profile.create',
      targetType: 'voice_profile',
      targetId: profile.id,
      ip: request.ip,
    })
    reply.status(201)
    return ok(request, serialize(profile))
  })

  app.delete('/v1/voice-profiles/:id', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const id = param(request, 'id')
    const deleted = await withTenant(deps.db, auth.tenantId, (tx) =>
      deleteVoiceProfile(tx, auth.tenantId, id),
    )
    if (!deleted) throw new AppError('NOT_FOUND', '音色配置不存在')
    await audit(deps.db, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'voice_profile.delete',
      targetType: 'voice_profile',
      targetId: id,
      ip: request.ip,
    })
    return ok(request, { deleted: true })
  })
}
