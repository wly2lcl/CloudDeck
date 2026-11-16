import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { getQuotaSnapshot, periodOf, withTenant } from '@clouddeck/db'
import { requireAuth } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { ok, parseBody } from './helpers'

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1),
  model: z.string().optional(),
  maxTokens: z.number().int().positive().max(32_000).default(1024),
})

export function registerGatewayRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.post('/v1/gateway/chat', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const body = parseBody(chatSchema, request.body)
    if (!deps.config.gatewayBaseUrl) {
      throw new AppError('CAPABILITY_UNAVAILABLE', '模型网关未配置')
    }

    const inputChars = body.messages.reduce((sum, message) => sum + message.content.length, 0)
    const estimateUsd = ((inputChars / 4 + body.maxTokens) / 1000) * 0.002
    const snapshot = await withTenant(deps.db, auth.tenantId, (tx) =>
      getQuotaSnapshot(tx, auth.tenantId, periodOf()),
    )
    if (!snapshot) throw new AppError('QUOTA_EXCEEDED', '租户配额未初始化')
    if (
      Number(snapshot.cost_usd) +
        Number(snapshot.reserved_cost_usd) +
        estimateUsd >
      Number(snapshot.max_cost_usd)
    ) {
      throw new AppError('QUOTA_EXCEEDED', '本月额度不足')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetch(
        `${deps.config.gatewayBaseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(deps.config.gatewayToken
              ? { authorization: `Bearer ${deps.config.gatewayToken}` }
              : {}),
          },
          body: JSON.stringify({
            model: body.model ?? deps.config.gatewayModel,
            messages: body.messages,
            max_tokens: body.maxTokens,
          }),
          signal: controller.signal,
        },
      )
      if (!response.ok) {
        throw new AppError('DRIVER_ERROR', `模型网关返回 ${response.status}`)
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      return ok(request, {
        text: payload.choices?.[0]?.message?.content ?? '',
        usage: {
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
        },
      })
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        'DRIVER_ERROR',
        error instanceof Error ? error.message : '模型网关调用失败',
      )
    } finally {
      clearTimeout(timer)
    }
  })
}
