import { randomUUID } from 'node:crypto'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import { authGuard } from './auth'
import type { AppDeps } from './deps'
import { AppError, errorEnvelope } from './errors'
import { registerAuthRoutes } from './routes/auth'
import { registerCapabilityRoutes } from './routes/capabilities'
import { registerCommentRoutes } from './routes/comments'
import { registerJobRoutes } from './routes/jobs'
import { registerProjectRoutes } from './routes/projects'
import { registerShareRoutes } from './routes/shares'
import { registerStorageRoutes } from './routes/storage'
import { registerTemplateRoutes } from './routes/templates'
import { registerTenantRoutes } from './routes/tenant'
import { registerWebhookRoutes } from './routes/webhooks'

export interface BuildServerOptions {
  logger?: boolean
}

export function buildServer(deps: AppDeps, options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
  })

  app.decorateRequest('auth', null)

  app.register(cors, {
    origin: deps.config.webOrigin,
    credentials: true,
  })

  app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
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

  const guard = authGuard(deps.config.authSecret)
  registerAuthRoutes(app, deps, guard)
  registerProjectRoutes(app, deps, guard)
  registerCapabilityRoutes(app, deps, guard)
  registerJobRoutes(app, deps, guard)
  registerTenantRoutes(app, deps, guard)
  registerCommentRoutes(app, deps, guard)
  registerTemplateRoutes(app, deps, guard)
  registerShareRoutes(app, deps, guard)
  registerWebhookRoutes(app, deps, guard)
  registerStorageRoutes(app, deps)

  return app
}
