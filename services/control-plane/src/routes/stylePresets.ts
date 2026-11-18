import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createSubtitleStylePreset,
  deleteSubtitleStylePreset,
  listSubtitleStylePresetVersions,
  listSubtitleStylePresets,
  restoreSubtitleStylePreset,
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

const importSchema = z.object({
  presets: z
    .array(createSchema)
    .min(1)
    .max(100),
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
        version: preset.version,
        createdAt: toIso(preset.created_at),
      })),
    )
  })

  app.get('/v1/subtitle-style-presets/export', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const presets = await withTenant(deps.db, auth.tenantId, (tx) =>
      listSubtitleStylePresets(tx, auth.tenantId),
    )
    return ok(request, {
      version: 1,
      presets: presets.map((preset) => ({ name: preset.name, style: preset.style })),
    })
  })

  app.post('/v1/subtitle-style-presets/import', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const body = parseBody(importSchema, request.body)
    let imported = 0
    await withTenant(deps.db, auth.tenantId, async (tx) => {
      for (const preset of body.presets) {
        await createSubtitleStylePreset(tx, {
          tenantId: auth.tenantId,
          name: preset.name,
          style: preset.style,
        })
        imported += 1
      }
    })
    await audit(deps.db, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'subtitle_style.import',
      ip: request.ip,
      detail: { imported },
    })
    return ok(request, { imported })
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
      version: preset.version,
      createdAt: toIso(preset.created_at),
    })
  })

  app.get(
    '/v1/subtitle-style-presets/:id/versions',
    { preHandler: guard },
    async (request) => {
      const auth = requireAuth(request)
      const versions = await withTenant(deps.db, auth.tenantId, (tx) =>
        listSubtitleStylePresetVersions(tx, auth.tenantId, param(request, 'id')),
      )
      return ok(
        request,
        versions.map((version) => ({
          id: version.id,
          version: version.version,
          style: version.style,
          createdAt: toIso(version.created_at),
        })),
      )
    },
  )

  app.post(
    '/v1/subtitle-style-presets/:id/versions/:version/restore',
    { preHandler: guard },
    async (request) => {
      const auth = requireAuth(request)
      const presetId = param(request, 'id')
      const version = Number(param(request, 'version'))
      const restored = await withTenant(deps.db, auth.tenantId, (tx) =>
        restoreSubtitleStylePreset(tx, auth.tenantId, presetId, version),
      )
      if (!restored) throw new AppError('NOT_FOUND', '预设版本不存在')
      await audit(deps.db, {
        tenantId: auth.tenantId,
        actorType: 'user',
        actorId: auth.userId,
        action: 'subtitle_style.restore',
        targetType: 'subtitle_style_preset',
        targetId: presetId,
        ip: request.ip,
        detail: { version },
      })
      return ok(request, {
        id: restored.id,
        name: restored.name,
        style: restored.style,
        version: restored.version,
        updatedAt: toIso(restored.updated_at),
      })
    },
  )

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
