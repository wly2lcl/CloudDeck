import { createTenant, createUser, upsertDeviceToken, type JobRow } from '@clouddeck/db'
import { createTestDb } from '@clouddeck/db/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { dispatchJobPush } from '../src/push'

let close: (() => Promise<void>) | null = null

afterEach(async () => {
  await close?.()
  close = null
})

describe('任务完成推送', () => {
  it('向租户设备令牌发送推送', async () => {
    const handle = await createTestDb()
    close = handle.close
    const tenant = await createTenant(handle.db, { name: '推送租户', slug: `t-${Date.now()}` })
    const user = await createUser(handle.db, {
      email: `push-${Date.now()}@example.com`,
      passwordHash: 'x',
    })
    await upsertDeviceToken(handle.db, {
      tenantId: tenant.id,
      userId: user.id,
      platform: 'android',
      token: 'device-token-123456',
    })

    const captured: { value: { tokens: string[]; title: string; data: { jobId: string } } | null } =
      { value: null }
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured.value = JSON.parse(String(init?.body)) as (typeof captured)['value']
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const job = { id: 'job-push', tenant_id: tenant.id, capability_id: 'demo.echo' } as JobRow
    await dispatchJobPush(
      handle.db,
      job,
      { title: '任务完成', body: 'demo.echo 已完成', event: 'job.succeeded' },
      { provider: 'http', url: 'http://push.local/send', fetchImpl },
    )

    expect(captured.value?.tokens).toEqual(['device-token-123456'])
    expect(captured.value?.title).toBe('任务完成')
    expect(captured.value?.data.jobId).toBe('job-push')
  })
})
