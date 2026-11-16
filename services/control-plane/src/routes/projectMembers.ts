import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  addProjectMember,
  findMembership,
  findUserByEmail,
  listProjectMembers,
  removeProjectMember,
  withTenant,
} from '@clouddeck/db'
import { audit } from '../audit'
import { requireAuth, requireRole } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { assertProjectAccess } from '../project-access'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const addSchema = z.object({
  email: z.string().email(),
  role: z.enum(['editor', 'viewer']).default('editor'),
})

export function registerProjectMemberRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/projects/:id/members', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const projectId = param(request, 'id')
    const members = await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertProjectAccess(tx, auth, projectId)
      return listProjectMembers(tx, auth.tenantId, projectId)
    })
    return ok(
      request,
      members.map((member) => ({
        userId: member.user_id,
        email: member.email,
        displayName: member.display_name,
        role: member.role,
        addedAt: toIso(member.created_at),
      })),
    )
  })

  app.post('/v1/projects/:id/members', { preHandler: guard }, async (request, reply) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const projectId = param(request, 'id')
    const body = parseBody(addSchema, request.body)

    await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertProjectAccess(tx, auth, projectId)
      const user = await findUserByEmail(tx, body.email)
      if (!user) throw new AppError('NOT_FOUND', '该邮箱尚未注册')
      if (!(await findMembership(tx, auth.tenantId, user.id))) {
        throw new AppError('VALIDATION_FAILED', '用户不是当前租户成员')
      }
      await addProjectMember(tx, {
        tenantId: auth.tenantId,
        projectId,
        userId: user.id,
        role: body.role,
      })
      await audit(tx, {
        tenantId: auth.tenantId,
        actorType: 'user',
        actorId: auth.userId,
        action: 'project.member.add',
        targetType: 'project',
        targetId: projectId,
        detail: { userId: user.id, role: body.role },
      })
    })
    reply.status(201)
    return ok(request, { projectId, email: body.email, role: body.role })
  })

  app.delete('/v1/projects/:id/members/:userId', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const projectId = param(request, 'id')
    const userId = param(request, 'userId')
    const removed = await withTenant(deps.db, auth.tenantId, async (tx) => {
      await assertProjectAccess(tx, auth, projectId)
      return removeProjectMember(tx, auth.tenantId, projectId, userId)
    })
    if (!removed) throw new AppError('NOT_FOUND', '项目成员不存在')
    await audit(deps.db, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'project.member.remove',
      targetType: 'project',
      targetId: projectId,
      detail: { userId },
    })
    return ok(request, { removed: true })
  })
}
