import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getCapability, listCapabilities } from '@clouddeck/db'
import { requireAuth } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { readFormSchema } from '../registry'
import { ok, param, queryString } from './helpers'

export function registerCapabilityRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/capabilities', { preHandler: guard }, async (request) => {
    requireAuth(request)
    const rows = await listCapabilities(deps.db)
    return ok(
      request,
      rows.map((row) => ({
        id: row.id,
        version: row.version,
        name: row.name,
        category: row.category,
        description: row.manifest.description,
        icon: row.manifest.icon ?? null,
        tags: row.manifest.tags,
        ui: row.manifest.ui,
        estimate: row.manifest.billing.estimate,
        unit: row.manifest.billing.unit,
      })),
    )
  })

  app.get('/v1/capabilities/:id', { preHandler: guard }, async (request) => {
    requireAuth(request)
    const row = await getCapability(deps.db, param(request, 'id'), queryString(request, 'version'))
    if (!row) throw new AppError('NOT_FOUND', '能力不存在')
    const form = readFormSchema(deps.config.capabilitiesDir, row.id, row.manifest.ui.form)
    return ok(request, {
      id: row.id,
      version: row.version,
      name: row.name,
      category: row.category,
      manifest: row.manifest,
      form,
    })
  })
}
