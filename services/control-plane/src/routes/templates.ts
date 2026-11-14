import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createProject,
  createTemplate,
  deleteTemplate,
  getTemplate,
  importPublicTemplate,
  listPublicTemplates,
  listTemplates,
  setTemplatePublic,
  withTenant,
  type PublicTemplateRow,
  type TemplateRow,
} from '@clouddeck/db'
import { requireAuth, requireRole } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { serializeProject } from './projects'
import { ok, param, parseBody } from './helpers'

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
})

const projectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
})

function serializeTemplate(template: TemplateRow) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    payload: template.payload,
    isPublic: template.is_public,
    createdAt: toIso(template.created_at),
  }
}

function serializePublicTemplate(template: PublicTemplateRow) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    payload: template.payload,
    createdAt: toIso(template.created_at),
  }
}

export function registerTemplateRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/templates', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const templates = await withTenant(deps.db, auth.tenantId, (tx) =>
      listTemplates(tx, auth.tenantId),
    )
    return ok(request, templates.map(serializeTemplate))
  })

  app.post('/v1/templates', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = parseBody(createSchema, request.body)
    const template = await withTenant(deps.db, auth.tenantId, (tx) =>
      createTemplate(tx, {
        tenantId: auth.tenantId,
        name: body.name,
        description: body.description,
        payload: body.payload,
      }),
    )
    reply.status(201)
    return ok(request, serializeTemplate(template))
  })

  app.get('/v1/templates/public', { preHandler: guard }, async (request) => {
    requireAuth(request)
    const templates = await listPublicTemplates(deps.db)
    return ok(request, templates.map(serializePublicTemplate))
  })

  app.post('/v1/templates/public/:id/import', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const template = await withTenant(deps.db, auth.tenantId, (tx) =>
      importPublicTemplate(tx, auth.tenantId, param(request, 'id')),
    )
    if (!template) throw new AppError('NOT_FOUND', '公开模板不存在')
    reply.status(201)
    return ok(request, serializeTemplate(template))
  })

  app.patch('/v1/templates/:id/public', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const body = parseBody(
      z.object({ isPublic: z.boolean() }),
      request.body,
    )
    const updated = await withTenant(deps.db, auth.tenantId, (tx) =>
      setTemplatePublic(tx, auth.tenantId, param(request, 'id'), body.isPublic),
    )
    if (!updated) throw new AppError('NOT_FOUND', '模板不存在')
    return ok(request, { id: param(request, 'id'), isPublic: body.isPublic })
  })

  app.delete('/v1/templates/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const deleted = await withTenant(deps.db, auth.tenantId, (tx) =>
      deleteTemplate(tx, auth.tenantId, param(request, 'id')),
    )
    if (!deleted) throw new AppError('NOT_FOUND', '模板不存在')
    return ok(request, { deleted: true })
  })

  app.post('/v1/templates/:id/projects', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = parseBody(projectSchema, request.body)
    const templateId = param(request, 'id')

    const project = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const template = await getTemplate(tx, auth.tenantId, templateId)
      if (!template) throw new AppError('NOT_FOUND', '模板不存在')
      return createProject(tx, {
        tenantId: auth.tenantId,
        name: body.name ?? template.name,
        description: template.description ?? undefined,
        createdBy: auth.userId,
      })
    })

    reply.status(201)
    return ok(request, serializeProject(project))
  })
}
