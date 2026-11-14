import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '../src/errors.js'
import { buildServer } from '../src/server.js'

const servers: ReturnType<typeof buildServer>[] = []

function makeServer() {
  const app = buildServer()
  servers.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((app) => app.close()))
})

describe('control-plane 基础接口', () => {
  it('GET /healthz 返回统一信封与请求 ID', async () => {
    const app = makeServer()
    const response = await app.inject({ method: 'GET', url: '/healthz' })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.data.status).toBe('ok')
    expect(body.data.service).toBe('control-plane')
    expect(body.requestId).toBeTruthy()
    expect(response.headers['x-request-id']).toBe(body.requestId)
  })

  it('未知路由返回 404 信封', async () => {
    const app = makeServer()
    const response = await app.inject({ method: 'GET', url: '/v1/missing' })

    expect(response.statusCode).toBe(404)
    const body = response.json()
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.requestId).toBeTruthy()
  })

  it('AppError 映射为对应状态码与错误码', async () => {
    const app = makeServer()
    app.get('/boom', async () => {
      throw new AppError('VALIDATION_FAILED', '参数非法', { field: 'capabilityId' })
    })

    const response = await app.inject({ method: 'GET', url: '/boom' })
    expect(response.statusCode).toBe(422)
    const body = response.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.message).toBe('参数非法')
    expect(body.error.details).toEqual({ field: 'capabilityId' })
  })
})
