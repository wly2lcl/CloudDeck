import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import { loadConfig } from './config.js'
import { AppError, errorEnvelope } from './errors.js'

export interface BuildServerOptions {
  logger?: boolean
  webOrigin?: string
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const config = loadConfig()
  const app = Fastify({ logger: options.logger ?? false, genReqId: () => randomUUID() })

  app.register(cors, {
    origin: options.webOrigin ?? config.webOrigin,
    credentials: true,
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(errorEnvelope(error.code, error.message, request.id, error.details))
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

  return app
}

async function main(): Promise<void> {
  const config = loadConfig()
  const app = buildServer({ logger: true, webOrigin: config.webOrigin })

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, '正在关闭控制面')
    await app.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ port: config.port, host: config.host })
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error('控制面启动失败', error)
    process.exit(1)
  })
}
