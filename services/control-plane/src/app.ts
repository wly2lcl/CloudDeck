import { randomUUID } from 'node:crypto'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import rawBody from 'fastify-raw-body'
import { globalJobStatusCounts, globalUsageTotal } from '@clouddeck/db'
import { authGuard } from './auth'
import type { AppDeps } from './deps'
import { AppError, errorEnvelope } from './errors'
import { registerAdminRoutes } from './routes/admin'
import { registerApiKeyRoutes } from './routes/apiKeys'
import { registerAuthRoutes } from './routes/auth'
import { registerCapabilityRoutes } from './routes/capabilities'
import { registerCollabRoutes } from './routes/collab'
import { registerCommentRoutes } from './routes/comments'
import { registerCredentialRoutes } from './routes/credentials'
import { registerDeviceRoutes } from './routes/devices'
import { registerPaymentRoutes } from './routes/payments'
import { registerGatewayRoutes } from './routes/gateway'
import { registerJobRoutes } from './routes/jobs'
import { registerMemberRoutes } from './routes/members'
import { registerProjectMemberRoutes } from './routes/projectMembers'
import { registerProjectRoutes } from './routes/projects'
import { registerShareRoutes } from './routes/shares'
import { registerStorageRoutes } from './routes/storage'
import { registerTemplateRoutes } from './routes/templates'
import { registerTenantRoutes } from './routes/tenant'
import { registerVoiceProfileRoutes } from './routes/voiceProfiles'
import { registerWebhookRoutes } from './routes/webhooks'

export interface BuildServerOptions {
  logger?: boolean
}

export async function buildServer(
  deps: AppDeps,
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
  })

  app.decorateRequest('auth', null)

  await app.register(cors, {
    origin: deps.config.webOrigin,
    credentials: true,
  })

  await app.register(websocket)

  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  })

  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  })
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(rateLimit, {
    max: deps.config.rateLimitMax,
    timeWindow: '1 minute',
  })

  const requestCounts = new Map<string, number>()

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })

  app.addHook('onResponse', async (request, reply) => {
    const key = `${request.method}|${reply.statusCode}`
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1)
  })

  app.get('/metrics', async (request, reply) => {
    const [statuses, usageTotal] = await Promise.all([
      globalJobStatusCounts(deps.db),
      globalUsageTotal(deps.db),
    ])

    const lines = [
      '# HELP clouddeck_up 服务存活',
      '# TYPE clouddeck_up gauge',
      'clouddeck_up 1',
      '# HELP clouddeck_jobs 任务数量（按状态）',
      '# TYPE clouddeck_jobs gauge',
      ...statuses.map(
        (row) => `clouddeck_jobs{status="${row.status}"} ${row.count}`,
      ),
      '# HELP clouddeck_usage_usd_total 平台累计用量金额',
      '# TYPE clouddeck_usage_usd_total counter',
      `clouddeck_usage_usd_total ${usageTotal.toFixed(4)}`,
      '# HELP clouddeck_http_requests_total HTTP 请求数',
      '# TYPE clouddeck_http_requests_total counter',
      ...[...requestCounts.entries()].map(([key, count]) => {
        const [method, status] = key.split('|')
        return `clouddeck_http_requests_total{method="${method}",status="${status}"} ${count}`
      }),
    ]

    reply.type('text/plain; version=0.0.4; charset=utf-8')
    return lines.join('\n')
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply
        .status(error.statusCode)
        .send(errorEnvelope(error.code, error.message, request.id, error.details))
      return
    }

    const status = (error as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : '请求无效'
      reply.status(status).send(errorEnvelope('VALIDATION_FAILED', message, request.id))
      return
    }

    request.log.error({ err: error }, '未处理错误')
    reply.status(500).send(errorEnvelope('INTERNAL', '服务器内部错误', request.id))
  })

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errorEnvelope('NOT_FOUND', '资源不存在', request.id))
  })

  app.get('/healthz', async (request) => ({
    data: {
      status: 'ok',
      service: 'control-plane',
      version: '0.1.0',
      time: new Date().toISOString(),
    },
    requestId: request.id,
  }))

  const guard = authGuard(deps.config.authSecret, deps.db)
  registerAuthRoutes(app, deps, guard)
  registerAdminRoutes(app, deps, guard)
  registerApiKeyRoutes(app, deps, guard)
  registerMemberRoutes(app, deps, guard)
  registerProjectRoutes(app, deps, guard)
  registerProjectMemberRoutes(app, deps, guard)
  registerCapabilityRoutes(app, deps, guard)
  registerGatewayRoutes(app, deps, guard)
  registerJobRoutes(app, deps, guard)
  registerTenantRoutes(app, deps, guard)
  registerCommentRoutes(app, deps, guard)
  registerCollabRoutes(app, deps)
  registerCredentialRoutes(app, deps, guard)
  registerDeviceRoutes(app, deps, guard)
  registerPaymentRoutes(app, deps, guard)
  registerTemplateRoutes(app, deps, guard)
  registerShareRoutes(app, deps, guard)
  registerWebhookRoutes(app, deps, guard)
  registerVoiceProfileRoutes(app, deps, guard)
  registerStorageRoutes(app, deps)

  return app
}
