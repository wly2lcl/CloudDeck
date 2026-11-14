import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  getCapability,
  isCapabilityEnabled,
  listCapabilitiesForTenant,
} from '@clouddeck/db'
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
    const auth = requireAuth(request)
    const rows = await listCapabilitiesForTenant(deps.db, auth.tenantId)
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
    const auth = requireAuth(request)
    const id = param(request, 'id')
    if (!(await isCapabilityEnabled(deps.db, auth.tenantId, id))) {
      throw new AppError('NOT_FOUND', '能力未启用')
    }
    const row = await getCapability(deps.db, id, queryString(request, 'version'))
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
