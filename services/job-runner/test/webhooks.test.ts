import { createServer, type Server } from 'node:http'
import { createTenant, createWebhook, listWebhookDeliveries, type JobRow } from '@clouddeck/db'
import { createTestDb } from '@clouddeck/db/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { dispatchJobWebhooks, signWebhook } from '../src/webhooks'

const servers: Server[] = []
let close: (() => Promise<void>) | null = null

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
  await close?.()
  close = null
})

function startWebhookServer(status: number) {
  const received: { body: string; signature: string; timestamp: string; event: string }[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      received.push({
        body,
        signature: String(request.headers['x-clouddeck-signature'] ?? ''),
        timestamp: String(request.headers['x-clouddeck-timestamp'] ?? ''),
        event: String(request.headers['x-clouddeck-event'] ?? ''),
      })
      response.writeHead(status)
      response.end('{}')
    })
  })
  servers.push(server)

  return new Promise<{ url: string; received: typeof received }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ url: `http://127.0.0.1:${port}/hook`, received })
    })
  })
}

async function setup(url: string, events: string[], secret: string) {
  const handle = await createTestDb()
  close = handle.close
  const tenant = await createTenant(handle.db, { name: 'Webhook 租户', slug: `t-${Date.now()}` })
  const hook = await createWebhook(handle.db, {
    tenantId: tenant.id,
    url,
    secret,
    events,
  })
  const job = { id: 'job-webhook', tenant_id: tenant.id } as JobRow
  return { db: handle.db, tenant, hook, job }
}

describe('Webhook 投递', () => {
  it('签名正确并记录 delivered', async () => {
    const { url, received } = await startWebhookServer(200)
    const { db, tenant, job } = await setup(url, ['job.succeeded'], 'secret-1')

    await dispatchJobWebhooks(db, job, 'job.succeeded', { status: 'succeeded' })

    expect(received).toHaveLength(1)
    const payload = received[0] as (typeof received)[number]
    expect(payload.event).toBe('job.succeeded')
    expect(payload.signature).toBe(signWebhook('secret-1', payload.timestamp, payload.body))

    const deliveries = await listWebhookDeliveries(db, tenant.id)
    expect(deliveries[0]?.status).toBe('delivered')
    expect(deliveries[0]?.attempts).toBe(1)
  })

  it('失败重试后记录 failed', async () => {
    const { url } = await startWebhookServer(500)
    const { db, tenant, job } = await setup(url, ['job.failed'], 'secret-2')

    await dispatchJobWebhooks(
      db,
      job,
      'job.failed',
      { status: 'failed' },
      { sleep: async () => {}, maxAttempts: 2 },
    )

    const deliveries = await listWebhookDeliveries(db, tenant.id)
    expect(deliveries[0]?.status).toBe('failed')
    expect(deliveries[0]?.attempts).toBe(2)
    expect(deliveries[0]?.last_error).toContain('500')
  })
})
