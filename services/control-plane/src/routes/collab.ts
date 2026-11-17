import type { FastifyInstance } from 'fastify'
import { getCollabDoc, upsertCollabDoc, withTenant } from '@clouddeck/db'
import * as Y from 'yjs'
import { verifyAccessToken } from '../auth'
import type { AppDeps } from '../deps'
import { assertProjectAccess } from '../project-access'
import { param } from './helpers'

/**
 * Yjs 协作房间：/v1/collab/:room?token=JWT
 * room 形如 <projectId>_<docId>，房间键包含租户避免跨租户冲突。
 * 当前使用 y-websocket 内存文档；进程重启后由客户端重新同步。
 */
export function registerCollabRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/collab/:room', { websocket: true }, async (socket, request) => {
    try {
      const token = (request.query as { token?: string }).token
      if (!token) throw new Error('缺少 token')
      const auth = await verifyAccessToken(deps.config.authSecret, token)
      const room = param(request, 'room')
      const separator = room.indexOf('_')
      if (separator <= 0) throw new Error('房间格式非法')
      const projectId = room.slice(0, separator)
      const docId = room.slice(separator + 1) || 'manuscript'
      await withTenant(deps.db, auth.tenantId, (tx) =>
        assertProjectAccess(tx, auth, projectId),
      )

      const utils = (await import('y-websocket/bin/utils')) as unknown as {
        setupWSConnection: (
          socket: unknown,
          request: unknown,
          options?: { docName?: string; gc?: boolean },
        ) => void
        getYDoc: (docName: string, gc?: boolean) => Y.Doc
      }
      const docName = `${auth.tenantId}:${projectId}:${docId}`
      const doc = utils.getYDoc(docName)
      const state = await withTenant(deps.db, auth.tenantId, (tx) =>
        getCollabDoc(tx, auth.tenantId, projectId, docId),
      ).catch(() => null)
      if (state) Y.applyUpdate(doc, Buffer.from(state, 'base64'))

      const save = () => {
        const stateB64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
        void withTenant(deps.db, auth.tenantId, (tx) =>
          upsertCollabDoc(tx, { tenantId: auth.tenantId, projectId, docId, stateB64 }),
        ).catch((error) => console.error('协作文档持久化失败', error))
      }
      const timer = setInterval(save, 1000)
      doc.on('update', save)
      socket.on('close', () => {
        clearInterval(timer)
        save()
      })

      utils.setupWSConnection(socket, request.raw, { docName, gc: true })
    } catch {
      socket.close(4401, 'unauthorized')
    }
  })
}
