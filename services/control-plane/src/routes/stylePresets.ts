import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createSubtitleStylePreset,
  deleteSubtitleStylePreset,
  listSubtitleStylePresets,
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
  style: z.record(z.string(), z.string()),
})

export function registerStylePresetRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/subtitle-style-presets', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const presets = await withTenant(deps.db, auth.tenantId, (tx) =>
      listSubtitleStylePresets(tx, auth.tenantId),
    )
    return ok(
      request,
      presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        style: preset.style,
        createdAt: toIso(preset.created_at),
      })),
    )
  })

  app.post('/v1/subtitle-style-presets', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = parseBody(createSchema, request.body)
    const preset = await withTenant(deps.db, auth.tenantId, (tx) =>
      createSubtitleStylePreset(tx, {
        tenantId: auth.tenantId,
        name: body.name,
        style: body.style,
      }),
    )
    await audit(deps.db, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'subtitle_style.save',
      targetType: 'subtitle_style_preset',
      targetId: preset.id,
      ip: request.ip,
    })
    reply.status(201)
    return ok(request, {
      id: preset.id,
      name: preset.name,
      style: preset.style,
      createdAt: toIso(preset.created_at),
    })
  })

  app.delete('/v1/subtitle-style-presets/:id', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const id = param(request, 'id')
    const deleted = await withTenant(deps.db, auth.tenantId, (tx) =>
      deleteSubtitleStylePreset(tx, auth.tenantId, id),
    )
    if (!deleted) throw new AppError('NOT_FOUND', '样式预设不存在')
    return ok(request, { deleted: true })
  })
}
