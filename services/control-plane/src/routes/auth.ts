import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  addMembership,
  createEmailVerification,
  createPasswordReset,
  createSession,
  createTenant,
  createUser,
  findEmailVerificationByHash,
  findInvitationByHash,
  findMembership,
  findPasswordResetByHash,
  findSessionByRefreshHash,
  findUserByEmail,
  findUserById,
  listMemberships,
  markEmailVerificationUsed,
  markInvitationAccepted,
  markEmailVerified,
  markPasswordResetUsed,
  revokeSession,
  revokeUserSessions,
  rotateSession,
  updateUserPassword,
  type Database,
} from '@clouddeck/db'
import {
  createRefreshToken,
  hashPassword,
  hashToken,
  issueAccessToken,
  requireAuth,
  verifyPassword,
} from '../auth'
import { audit } from '../audit'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { toTime } from '../time'
import { ok, parseBody } from './helpers'

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64).optional(),
  tenantName: z.string().min(1).max(64).optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantId: z.string().uuid().optional(),
})

const refreshSchema = z.object({ refreshToken: z.string().min(16) })
const switchSchema = z.object({ tenantId: z.string().uuid() })
const forgotSchema = z.object({ email: z.string().email() })
const resetSchema = z.object({ token: z.string().min(16), password: z.string().min(8).max(128) })
const verifySchema = z.object({ token: z.string().min(16) })
const acceptInviteSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64).optional(),
})

async function issueSession(
  deps: AppDeps,
  input: { userId: string; tenantId: string; role: string; device?: string; ip?: string },
) {
  const refreshToken = createRefreshToken()
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)
  const session = await createSession(deps.db, {
    userId: input.userId,
    tenantId: input.tenantId,
    refreshTokenHash: hashToken(refreshToken),
    expiresAt,
    device: input.device,
    ip: input.ip,
  })
  const accessToken = await issueAccessToken(deps.config.authSecret, {
    userId: input.userId,
    tenantId: input.tenantId,
    role: input.role,
  })
  return { accessToken, refreshToken, sessionId: session.id, tenantId: input.tenantId }
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.post(
    '/v1/auth/register',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
    const body = parseBody(registerSchema, request.body)
    if (await findUserByEmail(deps.db, body.email)) {
      throw new AppError('VALIDATION_FAILED', '邮箱已注册')
    }

    const { user, tenant } = await deps.db.transaction(async (tx) => {
      const db = tx as unknown as Database
      const user = await createUser(db, {
        email: body.email,
        passwordHash: hashPassword(body.password),
        displayName: body.displayName,
      })
      const tenant = await createTenant(db, {
        name: body.tenantName ?? `${body.displayName ?? body.email.split('@')[0]} 的空间`,
        slug: `t-${randomUUID().slice(0, 8)}`,
      })
      await addMembership(db, tenant.id, user.id, 'owner')
      return { user, tenant }
    })

    const tokens = await issueSession(deps, {
      userId: user.id,
      tenantId: tenant.id,
      role: 'owner',
      device: request.headers['user-agent'],
      ip: request.ip,
    })

    const verificationToken = createRefreshToken()
    await createEmailVerification(deps.db, {
      userId: user.id,
      tokenHash: hashToken(verificationToken),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    await audit(deps.db, {
      tenantId: tenant.id,
      actorType: 'user',
      actorId: user.id,
      action: 'auth.register',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    })

      reply.status(201)
      return ok(request, {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          emailVerified: false,
        },
        tenants: [{ ...tenant, role: 'owner' }],
        ...(deps.config.exposeAuthTokens ? { emailVerificationToken: verificationToken } : {}),
        ...tokens,
      })
    },
  )

  app.post(
    '/v1/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
    const body = parseBody(loginSchema, request.body)
    const user = await findUserByEmail(deps.db, body.email)
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw new AppError('UNAUTHENTICATED', '邮箱或密码错误')
    }

    const memberships = await listMemberships(deps.db, user.id)
    const membership = body.tenantId
      ? memberships.find((item) => item.tenant_id === body.tenantId)
      : memberships[0]
    if (!membership) throw new AppError('FORBIDDEN', '没有可用的租户')

    const tokens = await issueSession(deps, {
      userId: user.id,
      tenantId: membership.tenant_id,
      role: membership.role,
      device: request.headers['user-agent'],
      ip: request.ip,
    })
    await audit(deps.db, {
      tenantId: membership.tenant_id,
      actorType: 'user',
      actorId: user.id,
      action: 'auth.login',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    })

      return ok(request, {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          emailVerified: user.email_verified_at !== null,
        },
        tenant: {
          id: membership.tenant_id,
          name: membership.name,
          slug: membership.slug,
          tier: membership.tier,
          role: membership.role,
        },
        ...tokens,
      })
    },
  )

  app.post('/v1/auth/refresh', async (request) => {
    const body = parseBody(refreshSchema, request.body)
    const session = await findSessionByRefreshHash(deps.db, hashToken(body.refreshToken))
    if (!session || session.revoked_at || toTime(session.expires_at) < Date.now()) {
      throw new AppError('UNAUTHENTICATED', '刷新令牌无效或已过期')
    }

    const membership = await findMembership(deps.db, session.tenant_id, session.user_id)
    if (!membership) throw new AppError('FORBIDDEN', '租户成员关系已失效')

    const refreshToken = createRefreshToken()
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)
    await rotateSession(deps.db, session.id, hashToken(refreshToken), expiresAt)

    const accessToken = await issueAccessToken(deps.config.authSecret, {
      userId: session.user_id,
      tenantId: session.tenant_id,
      role: membership.role,
    })

    return ok(request, {
      accessToken,
      refreshToken,
      tenantId: session.tenant_id,
      role: membership.role,
    })
  })

  app.post(
    '/v1/auth/forgot-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const body = parseBody(forgotSchema, request.body)
      const user = await findUserByEmail(deps.db, body.email)
      if (!user) return ok(request, { sent: true })

      const token = createRefreshToken()
      await createPasswordReset(deps.db, {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      return ok(request, {
        sent: true,
        ...(deps.config.exposeAuthTokens ? { token } : {}),
      })
    },
  )

  app.post('/v1/auth/reset-password', async (request) => {
    const body = parseBody(resetSchema, request.body)
    const reset = await findPasswordResetByHash(deps.db, hashToken(body.token))
    if (!reset || reset.used_at || toTime(reset.expires_at) < Date.now()) {
      throw new AppError('UNAUTHENTICATED', '重置令牌无效或已过期')
    }
    await updateUserPassword(deps.db, reset.user_id, hashPassword(body.password))
    await markPasswordResetUsed(deps.db, reset.id)
    await revokeUserSessions(deps.db, reset.user_id)
    return ok(request, { reset: true })
  })

  app.post('/v1/auth/verify-email', async (request) => {
    const body = parseBody(verifySchema, request.body)
    const verification = await findEmailVerificationByHash(deps.db, hashToken(body.token))
    if (!verification || verification.used_at || toTime(verification.expires_at) < Date.now()) {
      throw new AppError('UNAUTHENTICATED', '验证令牌无效或已过期')
    }
    await markEmailVerified(deps.db, verification.user_id)
    await markEmailVerificationUsed(deps.db, verification.id)
    return ok(request, { verified: true })
  })

  app.post('/v1/auth/accept-invite', async (request) => {
    const body = parseBody(acceptInviteSchema, request.body)
    const invitation = await findInvitationByHash(deps.db, hashToken(body.token))
    if (
      !invitation ||
      invitation.accepted_at ||
      toTime(invitation.expires_at) < Date.now()
    ) {
      throw new AppError('UNAUTHENTICATED', '邀请无效或已过期')
    }

    let user = await findUserByEmail(deps.db, invitation.email)
    if (!user) {
      user = await createUser(deps.db, {
        email: invitation.email,
        passwordHash: hashPassword(body.password),
        displayName: body.displayName,
      })
    } else if (!verifyPassword(body.password, user.password_hash)) {
      throw new AppError('UNAUTHENTICATED', '邮箱或密码错误')
    }

    if (!(await findMembership(deps.db, invitation.tenant_id, user.id))) {
      await addMembership(deps.db, invitation.tenant_id, user.id, invitation.role)
    }
    await markInvitationAccepted(deps.db, invitation.id)

    const tokens = await issueSession(deps, {
      userId: user.id,
      tenantId: invitation.tenant_id,
      role: invitation.role,
      device: request.headers['user-agent'],
      ip: request.ip,
    })
    await audit(deps.db, {
      tenantId: invitation.tenant_id,
      actorType: 'user',
      actorId: user.id,
      action: 'member.accept',
      targetType: 'invitation',
      targetId: invitation.id,
      ip: request.ip,
    })
    return ok(request, {
      user: { id: user.id, email: user.email, displayName: user.display_name },
      role: invitation.role,
      ...tokens,
    })
  })

  app.post('/v1/auth/logout', async (request) => {
    const body = parseBody(refreshSchema, request.body)
    const session = await findSessionByRefreshHash(deps.db, hashToken(body.refreshToken))
    if (session) await revokeSession(deps.db, session.id)
    return ok(request, { revoked: session !== null })
  })

  app.post('/v1/auth/switch-tenant', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const body = parseBody(switchSchema, request.body)
    const membership = await findMembership(deps.db, body.tenantId, auth.userId)
    if (!membership) throw new AppError('FORBIDDEN', '不属于该租户')

    const refreshToken = createRefreshToken()
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)
    await createSession(deps.db, {
      userId: auth.userId,
      tenantId: body.tenantId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt,
      device: request.headers['user-agent'],
      ip: request.ip,
    })
    const accessToken = await issueAccessToken(deps.config.authSecret, {
      userId: auth.userId,
      tenantId: body.tenantId,
      role: membership.role,
    })
    return ok(request, { accessToken, refreshToken, tenantId: body.tenantId, role: membership.role })
  })

  app.get('/v1/me', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const user = await findUserById(deps.db, auth.userId)
    if (!user) throw new AppError('NOT_FOUND', '用户不存在')
    const memberships = await listMemberships(deps.db, user.id)
    return ok(request, {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        emailVerified: user.email_verified_at !== null,
      },
      tenants: memberships.map((item) => ({
        id: item.tenant_id,
        name: item.name,
        slug: item.slug,
        tier: item.tier,
        role: item.role,
      })),
      activeTenantId: auth.tenantId,
      platformAdmin: deps.config.platformAdminEmails.includes(user.email.toLowerCase()),
    })
  })
}
