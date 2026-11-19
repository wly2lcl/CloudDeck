import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { getJob, getQuotaSnapshot, listModelCredentials, periodOf, withTenant } from '@clouddeck/db'
import { decryptSecret, deriveMasterKey } from '@clouddeck/secrets'
import { issueJobToken, requireAuth } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { ok, parseBody } from './helpers'

function defaultBaseUrl(provider: string): string | undefined {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1'
    case 'openrouter':
      return 'https://openrouter.ai/api/v1'
    case 'deepseek':
      return 'https://api.deepseek.com/v1'
    case 'siliconflow':
      return 'https://api.siliconflow.cn/v1'
    case 'dashscope':
    case 'bailian':
      return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    default:
      return undefined
  }
}

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
  app.post('/v1/jobs/:id/gateway-token', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const jobId = String((request.params as { id?: string }).id ?? '')
    const job = await withTenant(deps.db, auth.tenantId, (tx) =>
      getJob(tx, auth.tenantId, jobId),
    )
    if (!job) throw new AppError('NOT_FOUND', '任务不存在')
    const token = await issueJobToken(deps.config.authSecret, { ...auth, jobId })
    return ok(request, { token, expiresIn: 300 })
  })

  app.post('/v1/gateway/chat', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    if (auth.jobId) {
      const job = await withTenant(deps.db, auth.tenantId, (tx) =>
        getJob(tx, auth.tenantId, auth.jobId as string),
      )
      if (!job) throw new AppError('NOT_FOUND', '任务不存在')
    }
    const body = parseBody(chatSchema, request.body)
    let baseUrl = deps.config.gatewayBaseUrl
    let token = deps.config.gatewayToken
    let model = body.model ?? deps.config.gatewayModel

    const credentials = deps.config.gatewayBaseUrl
      ? []
      : await withTenant(deps.db, auth.tenantId, (tx) =>
          listModelCredentials(tx, auth.tenantId),
        )
    const credential =
      credentials.find((item) => item.base_url) ??
      credentials.find((item) => defaultBaseUrl(item.provider))
    if (credential) {
      try {
        const masterKey = deriveMasterKey(deps.config.credentialsKey)
        baseUrl = credential.base_url ?? defaultBaseUrl(credential.provider)
        token = decryptSecret(credential.encrypted_secret, masterKey)
        model = body.model ?? credential.model ?? model
      } catch (error) {
        console.error('租户模型凭据解密失败，回退网关配置', error)
      }
    }
    if (!baseUrl || !model) {
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
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            model,
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
