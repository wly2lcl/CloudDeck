import type { FastifyInstance } from 'fastify'
import { verifyLocalSignature } from '@clouddeck/storage'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { queryString } from './helpers'

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
}

function mimeOf(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export function registerStorageRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/storage/local', async (request, reply) => {
    const key = queryString(request, 'key')
    const exp = Number(queryString(request, 'exp'))
    const sig = queryString(request, 'sig')
    if (!key || !sig || !Number.isFinite(exp)) {
      throw new AppError('VALIDATION_FAILED', '签名参数缺失')
    }
    if (!verifyLocalSignature(deps.config.storageLocalSecret, key, exp, sig)) {
      throw new AppError('FORBIDDEN', '下载签名无效或已过期')
    }

    const data = await deps.storage.get(key)
    reply.header('content-type', mimeOf(key))
    reply.header('cache-control', 'private, max-age=60')
    return reply.send(data)
  })
}
