import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { findApiKeyByHash, touchApiKey, type Database } from '@clouddeck/db'
import { SignJWT, jwtVerify } from 'jose'
import type { FastifyRequest } from 'fastify'
import { AppError } from './errors'
import { toTime } from './time'

export interface AuthContext {
  userId: string
  tenantId: string
  role: string
  jobId?: string
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createRefreshToken(): string {
  return randomBytes(32).toString('hex')
}

const secretKey = (secret: string) => new TextEncoder().encode(secret)

export async function issueAccessToken(secret: string, ctx: AuthContext): Promise<string> {
  return new SignJWT({ tid: ctx.tenantId, role: ctx.role, ...(ctx.jobId ? { job: ctx.jobId } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ctx.userId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secretKey(secret))
}

export async function issueJobToken(secret: string, ctx: AuthContext): Promise<string> {
  return new SignJWT({ tid: ctx.tenantId, role: 'gateway', job: ctx.jobId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ctx.userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secretKey(secret))
}

export async function verifyAccessToken(secret: string, token: string): Promise<AuthContext> {
  const { payload } = await jwtVerify(token, secretKey(secret))
  if (!payload.sub || typeof payload.tid !== 'string' || typeof payload.role !== 'string') {
    throw new Error('令牌载荷不完整')
  }
  return {
    userId: payload.sub,
    tenantId: payload.tid,
    role: payload.role,
    ...(typeof payload.job === 'string' ? { jobId: payload.job } : {}),
  }
}

export function authGuard(secret: string, db: Database) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined
    const apiKeyHeader = request.headers['x-api-key']
    const apiKey =
      bearer?.startsWith('cdk_') ? bearer : typeof apiKeyHeader === 'string' ? apiKeyHeader : undefined

    if (apiKey) {
      const record = await findApiKeyByHash(db, hashToken(apiKey))
      if (
        !record ||
        record.revoked_at ||
        (record.expires_at && toTime(record.expires_at) < Date.now()) ||
        !record.created_by
      ) {
        throw new AppError('UNAUTHENTICATED', 'API Key 无效或已过期')
      }
      request.auth = {
        userId: record.created_by,
        tenantId: record.tenant_id,
        role: 'api',
      }
      await touchApiKey(db, record.id)
      return
    }

    if (!bearer) {
      throw new AppError('UNAUTHENTICATED', '缺少访问令牌')
    }
    try {
      request.auth = await verifyAccessToken(secret, bearer)
    } catch {
      throw new AppError('UNAUTHENTICATED', '访问令牌无效或已过期')
    }
  }
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new AppError('UNAUTHENTICATED', '未登录')
  return request.auth
}

export function requireRole(request: FastifyRequest, roles: string[]): AuthContext {
  const auth = requireAuth(request)
  if (!roles.includes(auth.role)) throw new AppError('FORBIDDEN', '权限不足')
  return auth
}
