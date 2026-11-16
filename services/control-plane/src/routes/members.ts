import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  addMembership,
  countOwners,
  createInvitation,
  findMembership,
  findUserByEmail,
  listAuditLogs,
  listInvitations,
  listTenantMembers,
  removeMember,
  updateMemberRole,
  withTenant,
} from '@clouddeck/db'
import { audit } from '../audit'
import { hashToken, requireAuth, requireRole } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toIso } from '../time'
import { ok, param, parseBody, queryString } from './helpers'

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'editor', 'viewer']).default('editor'),
})

const roleSchema = z.object({
  role: z.enum(['owner', 'admin', 'editor', 'viewer']),
})

function assertTenant(request: FastifyRequest, authTenantId: string): string {
  const tenantId = param(request, 'id')
  if (tenantId !== authTenantId) throw new AppError('NOT_FOUND', '租户不存在')
  return tenantId
}

export function registerMemberRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.get('/v1/tenants/:id/members', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const tenantId = assertTenant(request, auth.tenantId)
    const members = await withTenant(deps.db, tenantId, (tx) =>
      listTenantMembers(tx, tenantId),
    )
    return ok(
      request,
      members.map((member) => ({
        userId: member.user_id,
        email: member.email,
        displayName: member.display_name,
        role: member.role,
        status: member.status,
        joinedAt: toIso(member.created_at),
      })),
    )
  })

  app.get('/v1/tenant-invitations', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const invitations = await withTenant(deps.db, auth.tenantId, (tx) =>
      listInvitations(tx, auth.tenantId),
    )
    return ok(
      request,
      invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: toIso(invitation.expires_at),
        createdAt: toIso(invitation.created_at),
      })),
    )
  })

  app.post('/v1/tenants/:id/members', { preHandler: guard }, async (request, reply) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const tenantId = assertTenant(request, auth.tenantId)
    const body = parseBody(inviteSchema, request.body)

    const user = await findUserByEmail(deps.db, body.email)
    if (!user) {
      const token = randomBytes(32).toString('hex')
      await createInvitation(deps.db, {
        tenantId,
        email: body.email,
        role: body.role,
        tokenHash: hashToken(token),
        invitedBy: auth.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      await deps.mailer
        .send({
          to: body.email,
          subject: '邀请你加入 CloudDeck 工作空间',
          text: `${deps.config.webOrigin}/accept-invite?token=${token}`,
        })
        .catch((error: unknown) => console.error('邀请邮件发送失败', error))
      await audit(deps.db, {
        tenantId,
        actorType: 'user',
        actorId: auth.userId,
        action: 'member.invite',
        targetType: 'email',
        targetId: body.email,
        ip: request.ip,
        detail: { role: body.role },
      })
      reply.status(201)
      return ok(request, {
        invited: true,
        email: body.email,
        role: body.role,
        ...(deps.config.exposeAuthTokens ? { token } : {}),
      })
    }
    if (await findMembership(deps.db, tenantId, user.id)) {
      throw new AppError('VALIDATION_FAILED', '该用户已是租户成员')
    }

    await addMembership(deps.db, tenantId, user.id, body.role)
    await audit(deps.db, {
      tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'member.add',
      targetType: 'user',
      targetId: user.id,
      ip: request.ip,
      detail: { role: body.role },
    })
    reply.status(201)
    return ok(request, {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      role: body.role,
    })
  })

  app.patch(
    '/v1/tenants/:id/members/:userId',
    { preHandler: guard },
    async (request) => {
      const auth = requireRole(request, ['owner', 'admin'])
      const tenantId = assertTenant(request, auth.tenantId)
      const userId = param(request, 'userId')
      const body = parseBody(roleSchema, request.body)

      const membership = await findMembership(deps.db, tenantId, userId)
      if (!membership) throw new AppError('NOT_FOUND', '成员不存在')
      if (
        membership.role === 'owner' &&
        body.role !== 'owner' &&
        (await countOwners(deps.db, tenantId)) <= 1
      ) {
        throw new AppError('VALIDATION_FAILED', '至少保留一个 owner')
      }

      await updateMemberRole(deps.db, tenantId, userId, body.role)
      await audit(deps.db, {
        tenantId,
        actorType: 'user',
        actorId: auth.userId,
        action: 'member.role',
        targetType: 'user',
        targetId: userId,
        ip: request.ip,
        detail: { from: membership.role, to: body.role },
      })
      return ok(request, { userId, role: body.role })
    },
  )

  app.delete(
    '/v1/tenants/:id/members/:userId',
    { preHandler: guard },
    async (request) => {
      const auth = requireRole(request, ['owner', 'admin'])
      const tenantId = assertTenant(request, auth.tenantId)
      const userId = param(request, 'userId')

      const membership = await findMembership(deps.db, tenantId, userId)
      if (!membership) throw new AppError('NOT_FOUND', '成员不存在')
      if (membership.role === 'owner' && (await countOwners(deps.db, tenantId)) <= 1) {
        throw new AppError('VALIDATION_FAILED', '至少保留一个 owner')
      }

      await removeMember(deps.db, tenantId, userId)
      await audit(deps.db, {
        tenantId,
        actorType: 'user',
        actorId: auth.userId,
        action: 'member.remove',
        targetType: 'user',
        targetId: userId,
        ip: request.ip,
      })
      return ok(request, { removed: true })
    },
  )

  app.get('/v1/audit-logs', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const limit = Math.min(Number(queryString(request, 'limit') ?? 100), 200)
    const logs = await withTenant(deps.db, auth.tenantId, (tx) =>
      listAuditLogs(tx, auth.tenantId, Number.isFinite(limit) ? limit : 100),
    )
    return ok(
      request,
      logs.map((log) => ({
        id: log.id,
        actorType: log.actor_type,
        actorId: log.actor_id,
        action: log.action,
        targetType: log.target_type,
        targetId: log.target_id,
        ip: log.ip,
        userAgent: log.user_agent,
        detail: log.detail,
        createdAt: toIso(log.created_at),
      })),
    )
  })
}
