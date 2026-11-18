import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { assetTypeSchema } from '@clouddeck/contracts'
import {
  addAssetVersion,
  createAsset,
  createProject,
  getAssetVersionDetail,
  linkAssets,
  listAssets,
  listAssetVersions,
  listProjectGraph,
  listProjects,
  softDeleteProject,
  withTenant,
  type AssetRow,
  type ProjectRow,
} from '@clouddeck/db'
import { storageKeyFor } from '@clouddeck/storage'
import { requireAuth } from '../auth'
import { assertAssetAccess, assertProjectAccess } from '../project-access'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody, queryString } from './helpers'

const projectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
})

const assetQuerySchema = z.object({
  type: assetTypeSchema.default('document'),
  name: z.string().min(1).max(200).optional(),
})

export function serializeProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

export function serializeAsset(row: AssetRow) {
  return {
    assetId: row.id,
    projectId: row.project_id,
    type: row.type,
    name: row.name,
    mime: row.mime,
    size: Number(row.size_bytes),
    checksum: row.checksum_sha256,
    latestVersion: row.latest_version,
    meta: row.meta,
    createdAt: toIso(row.created_at),
  }
}

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/projects', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const projects = await withTenant(deps.db, auth.tenantId, (tx) =>
      listProjects(tx, auth.tenantId),
    )
    return ok(request, projects.map(serializeProject))
  })

  app.post('/v1/projects', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = parseBody(projectSchema, request.body)
    const project = await withTenant(deps.db, auth.tenantId, (tx) =>
      createProject(tx, {
        tenantId: auth.tenantId,
        name: body.name,
        description: body.description,
        createdBy: auth.userId,
      }),
    )
    reply.status(201)
    return ok(request, serializeProject(project))
  })

  app.get('/v1/projects/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const project = await withTenant(deps.db, auth.tenantId, (tx) =>
      assertProjectAccess(tx, auth, param(request, 'id')),
    )
    return ok(request, serializeProject(project))
  })

  app.delete('/v1/projects/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const deleted = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const projectId = param(request, 'id')
      await assertProjectAccess(tx, auth, projectId)
      return softDeleteProject(tx, auth.tenantId, projectId)
    })
    if (!deleted) throw new AppError('NOT_FOUND', '项目不存在')
    return ok(request, { deleted: true })
  })

  app.get('/v1/projects/:id/assets', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const projectId = param(request, 'id')
    const assets = await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertProjectAccess(tx, auth, projectId)
      return listAssets(tx, auth.tenantId, projectId)
    })
    if (!assets) throw new AppError('NOT_FOUND', '项目不存在')
    return ok(request, assets.map(serializeAsset))
  })

  app.get('/v1/projects/:id/graph', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const projectId = param(request, 'id')
    const graph = await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertProjectAccess(tx, auth, projectId)
      return listProjectGraph(tx, auth.tenantId, projectId)
    })
    if (!graph) throw new AppError('NOT_FOUND', '项目不存在')

    return ok(request, {
      assets: graph.assets.map((asset) => ({
        assetId: asset.id,
        type: asset.type,
        name: asset.name,
        latestVersion: asset.latest_version,
      })),
      links: graph.links.map((link) => ({
        fromAssetId: link.from_asset_id,
        fromVersion: link.from_version,
        toAssetId: link.to_asset_id,
        toVersion: link.to_version,
        relation: link.relation,
      })),
    })
  })

  app.post('/v1/projects/:id/assets', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const projectId = param(request, 'id')
    const query = parseBody(assetQuerySchema, {
      type: queryString(request, 'type') ?? 'document',
      name: queryString(request, 'name'),
    })

    const upload = await request.file()
    if (!upload) throw new AppError('VALIDATION_FAILED', '缺少上传文件')
    const data = await upload.toBuffer()
    const name = query.name ?? upload.filename ?? 'upload.bin'

    const asset = await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertProjectAccess(tx, auth, projectId)

      const assetId = randomUUID()
      const key = storageKeyFor(auth.tenantId, projectId, assetId, 1, name)
      await deps.storage.put(key, data, upload.mimetype)
      return createAsset(tx, {
        id: assetId,
        tenantId: auth.tenantId,
        projectId,
        type: query.type,
        name,
        mime: upload.mimetype || 'application/octet-stream',
        sizeBytes: data.byteLength,
        checksumSha256: createHash('sha256').update(data).digest('hex'),
        storageKey: key,
        createdBy: auth.userId,
      })
    })

    reply.status(201)
    return ok(request, serializeAsset(asset))
  })

  app.get('/v1/assets/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const assetId = param(request, 'id')
    const result = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const asset = await assertAssetAccess(tx, auth, assetId)
      const versions = await listAssetVersions(tx, auth.tenantId, assetId)
      return { asset, versions }
    })
    if (!result) throw new AppError('NOT_FOUND', '资产不存在')

    return ok(request, {
      ...serializeAsset(result.asset),
      versions: result.versions.map((version) => ({
        version: version.version,
        size: Number(version.size_bytes),
        checksum: version.checksum_sha256,
        createdAt: toIso(version.created_at),
      })),
    })
  })

  app.post('/v1/assets/:id/versions', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const assetId = param(request, 'id')
    const upload = await request.file()
    if (!upload) throw new AppError('VALIDATION_FAILED', '缺少上传文件')
    const data = await upload.toBuffer()
    const name = queryString(request, 'name') ?? upload.filename ?? 'version.bin'

    const result = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const asset = await assertAssetAccess(tx, auth, assetId)
      const nextVersion = asset.latest_version + 1
      const key = storageKeyFor(auth.tenantId, asset.project_id, asset.id, nextVersion, name)
      await deps.storage.put(key, data, upload.mimetype)
      return addAssetVersion(tx, {
        tenantId: auth.tenantId,
        assetId,
        storageKey: key,
        sizeBytes: data.byteLength,
        checksumSha256: createHash('sha256').update(data).digest('hex'),
      })
    })

    reply.status(201)
    return ok(request, {
      assetId: result.asset.id,
      version: result.version,
      latestVersion: result.asset.latest_version,
    })
  })

  app.get('/v1/assets/:id/versions/:version/download', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const assetId = param(request, 'id')
    const version = Number.parseInt(param(request, 'version'), 10)
    if (!Number.isInteger(version) || version <= 0) {
      throw new AppError('VALIDATION_FAILED', '版本号非法')
    }

    const detail = await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertAssetAccess(tx, auth, assetId)
      return getAssetVersionDetail(tx, auth.tenantId, assetId, version)
    })
    if (!detail) throw new AppError('NOT_FOUND', '资产版本不存在')

    const url = await deps.storage.signedDownloadUrl(detail.storage_key, 300)
    return reply.redirect(url)
  })

  app.get('/v1/assets/:id/versions/:version/url', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const assetId = param(request, 'id')
    const version = Number.parseInt(param(request, 'version'), 10)
    if (!Number.isInteger(version) || version <= 0) {
      throw new AppError('VALIDATION_FAILED', '版本号非法')
    }
    const detail = await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertAssetAccess(tx, auth, assetId)
      return getAssetVersionDetail(tx, auth.tenantId, assetId, version)
    })
    if (!detail) throw new AppError('NOT_FOUND', '资产版本不存在')
    const url = await deps.storage.signedDownloadUrl(detail.storage_key, 300)
    return ok(request, { url, mime: detail.mime })
  })

  app.get('/v1/assets/:id/versions/:version/content', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const assetId = param(request, 'id')
    const version = Number.parseInt(param(request, 'version'), 10)
    if (!Number.isInteger(version) || version <= 0) {
      throw new AppError('VALIDATION_FAILED', '版本号非法')
    }
    const detail = await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertAssetAccess(tx, auth, assetId)
      return getAssetVersionDetail(tx, auth.tenantId, assetId, version)
    })
    if (!detail) throw new AppError('NOT_FOUND', '资产版本不存在')

    const isText =
      detail.mime.startsWith('text/') ||
      detail.mime === 'application/json' ||
      detail.mime.includes('markdown') || detail.mime === 'application/x-subrip'
    if (!isText) throw new AppError('VALIDATION_FAILED', '该资产不支持文本预览')
    if (Number(detail.size_bytes) > 1024 * 1024) {
      throw new AppError('VALIDATION_FAILED', '文件超过 1MB，请直接下载')
    }

    const data = await deps.storage.get(detail.storage_key)
    return ok(request, { mime: detail.mime, text: data.toString('utf8') })
  })

  app.post('/v1/assets/:id/links', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = parseBody(
      z.object({
        projectId: z.string().uuid(),
        fromAssetId: z.string().uuid(),
        fromVersion: z.number().int().positive(),
        toVersion: z.number().int().positive(),
        relation: z.string().default('derived_from'),
      }),
      request.body,
    )
    await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertProjectAccess(tx, auth, body.projectId)
      await assertAssetAccess(tx, auth, param(request, 'id'))
      await linkAssets(tx, {
        tenantId: auth.tenantId,
        projectId: body.projectId,
        fromAssetId: body.fromAssetId,
        fromVersion: body.fromVersion,
        toAssetId: param(request, 'id'),
        toVersion: body.toVersion,
        relation: body.relation,
      })
    })
    reply.status(201)
    return ok(request, { linked: true })
  })
}
