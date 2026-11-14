import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createShare,
  findShareByTokenHash,
  getAsset,
  getAssetVersionDetail,
  getProject,
  listAssetLinks,
  listAssets,
  listShares,
  revokeShare,
  withTenant,
  type ShareRow,
} from '@clouddeck/db'
import { hashToken, requireAuth } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso, toTime } from '../time'
import { ok, param, parseBody } from './helpers'

const createSchema = z.object({
  expiresInDays: z.number().int().positive().max(365).default(7),
})

function shareStatus(share: ShareRow): string {
  if (share.revoked_at) return 'revoked'
  if (share.expires_at && toTime(share.expires_at) < Date.now()) return 'expired'
  return 'active'
}

function serializeShare(share: ShareRow) {
  return {
    id: share.id,
    projectId: share.project_id,
    status: shareStatus(share),
    expiresAt: share.expires_at ? toIso(share.expires_at) : null,
    revokedAt: share.revoked_at ? toIso(share.revoked_at) : null,
    createdAt: toIso(share.created_at),
  }
}

async function resolvePublicShare(deps: AppDeps, token: string) {
  const share = await findShareByTokenHash(deps.db, hashToken(token))
  if (!share) throw new AppError('NOT_FOUND', '分享不存在')
  if (share.revoked_at) throw new AppError('NOT_FOUND', '分享已撤销')
  if (share.expires_at && toTime(share.expires_at) < Date.now()) {
    throw new AppError('NOT_FOUND', '分享已过期')
  }
  return share
}

export function registerShareRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.post('/v1/projects/:id/shares', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = parseBody(createSchema, request.body)
    const projectId = param(request, 'id')
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)

    const share = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const project = await getProject(tx, auth.tenantId, projectId)
      if (!project) throw new AppError('NOT_FOUND', '项目不存在')
      return createShare(tx, {
        tenantId: auth.tenantId,
        projectId,
        tokenHash: hashToken(token),
        expiresAt,
      })
    })

    reply.status(201)
    return ok(request, {
      ...serializeShare(share),
      token,
      url: `/share/${token}`,
    })
  })

  app.get('/v1/projects/:id/shares', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const shares = await withTenant(deps.db, auth.tenantId, (tx) =>
      listShares(tx, auth.tenantId, param(request, 'id')),
    )
    return ok(request, shares.map(serializeShare))
  })

  app.delete('/v1/shares/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const revoked = await withTenant(deps.db, auth.tenantId, (tx) =>
      revokeShare(tx, auth.tenantId, param(request, 'id')),
    )
    if (!revoked) throw new AppError('NOT_FOUND', '分享不存在或已撤销')
    return ok(request, { revoked: true })
  })

  app.get('/v1/public/shares/:token', async (request) => {
    const share = await resolvePublicShare(deps, param(request, 'token'))
    const data = await withTenant(deps.db, share.tenant_id, async (tx) => {
      const project = await getProject(tx, share.tenant_id, share.project_id)
      if (!project) return null
      const assets = await listAssets(tx, share.tenant_id, share.project_id)
      const links = await listAssetLinks(tx, share.tenant_id, share.project_id)
      return { project, assets, links }
    })
    if (!data) throw new AppError('NOT_FOUND', '项目不存在')

    return ok(request, {
      project: {
        id: data.project.id,
        name: data.project.name,
        description: data.project.description,
      },
      assets: data.assets.map((asset) => ({
        assetId: asset.id,
        type: asset.type,
        name: asset.name,
        latestVersion: asset.latest_version,
      })),
      links: data.links.map((link) => ({
        fromAssetId: link.from_asset_id,
        toAssetId: link.to_asset_id,
        relation: link.relation,
      })),
    })
  })

  app.get('/v1/public/shares/:token/assets/:assetId/content', async (request) => {
    const share = await resolvePublicShare(deps, param(request, 'token'))
    const assetId = param(request, 'assetId')

    const result = await withTenant(deps.db, share.tenant_id, async (tx) => {
      const asset = await getAsset(tx, share.tenant_id, assetId)
      if (!asset || asset.project_id !== share.project_id) return null
      const detail = await getAssetVersionDetail(
        tx,
        share.tenant_id,
        assetId,
        asset.latest_version,
      )
      return { asset, detail }
    })
    if (!result || !result.detail) throw new AppError('NOT_FOUND', '资产不存在')

    const detail = result.detail
    const isText =
      detail.mime.startsWith('text/') ||
      detail.mime === 'application/json' ||
      detail.mime.includes('markdown')
    if (!isText) throw new AppError('VALIDATION_FAILED', '该资产不支持文本预览')
    if (Number(detail.size_bytes) > 1024 * 1024) {
      throw new AppError('VALIDATION_FAILED', '文件超过 1MB')
    }

    const data = await deps.storage.get(detail.storage_key)
    return ok(request, { name: result.asset.name, mime: detail.mime, text: data.toString('utf8') })
  })
}
