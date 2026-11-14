import type { FastifyRequest } from 'fastify'
import { AppError } from '../errors'

export function ok<T>(request: FastifyRequest, data: T) {
  return { data, requestId: request.id }
}

export function parseBody<T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown } } },
  body: unknown,
): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', '参数校验失败', result.error.issues)
  }
  return result.data
}

export function param(request: FastifyRequest, key: string): string {
  const value = (request.params as Record<string, string | undefined>)[key]
  if (!value) throw new AppError('VALIDATION_FAILED', `缺少路径参数 ${key}`)
  return value
}

export function queryString(request: FastifyRequest, key: string): string | undefined {
  const value = (request.query as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

export const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled'])

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
