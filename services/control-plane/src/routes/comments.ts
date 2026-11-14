import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createComment,
  deleteComment,
  getComment,
  getProject,
  listComments,
  withTenant,
  type CommentRow,
} from '@clouddeck/db'
import { requireAuth } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const createSchema = z.object({
  body: z.string().min(1).max(4000),
  assetId: z.string().uuid().optional(),
})

function serializeComment(comment: CommentRow, userId: string, role: string) {
  return {
    id: comment.id,
    projectId: comment.project_id,
    assetId: comment.asset_id,
    body: comment.body,
    author: comment.author_name ?? comment.author_email,
    createdAt: toIso(comment.created_at),
    canDelete: comment.user_id === userId || role === 'owner' || role === 'admin',
  }
}

export function registerCommentRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/projects/:id/comments', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const projectId = param(request, 'id')
    const comments = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const project = await getProject(tx, auth.tenantId, projectId)
      if (!project) return null
      return listComments(tx, auth.tenantId, projectId)
    })
    if (!comments) throw new AppError('NOT_FOUND', '项目不存在')
    return ok(
      request,
      comments.map((comment) => serializeComment(comment, auth.userId, auth.role)),
    )
  })

  app.post('/v1/projects/:id/comments', { preHandler: guard }, async (request, reply) => {
    const auth = requireAuth(request)
    const projectId = param(request, 'id')
    const body = parseBody(createSchema, request.body)
    const comment = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const project = await getProject(tx, auth.tenantId, projectId)
      if (!project) throw new AppError('NOT_FOUND', '项目不存在')
      return createComment(tx, {
        tenantId: auth.tenantId,
        projectId,
        userId: auth.userId,
        body: body.body,
        assetId: body.assetId,
      })
    })
    reply.status(201)
    return ok(request, serializeComment(comment, auth.userId, auth.role))
  })

  app.delete('/v1/comments/:id', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const commentId = param(request, 'id')
    const deleted = await withTenant(deps.db, auth.tenantId, async (tx) => {
      const comment = await getComment(tx, auth.tenantId, commentId)
      if (!comment) return false
      if (comment.user_id !== auth.userId && auth.role !== 'owner' && auth.role !== 'admin') {
        throw new AppError('FORBIDDEN', '只能删除自己的评论')
      }
      return deleteComment(tx, auth.tenantId, commentId)
    })
    if (!deleted) throw new AppError('NOT_FOUND', '评论不存在')
    return ok(request, { deleted: true })
  })
}
