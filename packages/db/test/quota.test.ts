import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { getQuotaSnapshot, releaseQuota, reserveQuota, withTenant } from '../src/index'
import { createTestDb, type TestDb } from './helpers'

let handle: TestDb | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
})

async function seed() {
  handle = await createTestDb()
  const tenantId = '33333333-3333-4333-8333-333333333333'
  await handle.db.execute(sql`
    INSERT INTO tenants (id, name, slug) VALUES (${tenantId}, 'Quota', 'quota-t')
  `)
  await handle.db.execute(sql`
    INSERT INTO quota_limits (tenant_id, max_cost_usd, max_jobs, max_concurrency)
    VALUES (${tenantId}, 10, 100, 2)
  `)
  return { tenantId, period: '2026-11' }
}

describe('额度预留', () => {
  it('预留累计后拒绝超额，释放后可再次预留', async () => {
    const { tenantId, period } = await seed()
    if (!handle) throw new Error('db not ready')
    const { db } = handle

    const first = await withTenant(db, tenantId, (tx) =>
      reserveQuota(tx, tenantId, period, 4),
    )
    const second = await withTenant(db, tenantId, (tx) =>
      reserveQuota(tx, tenantId, period, 4),
    )
    const third = await withTenant(db, tenantId, (tx) =>
      reserveQuota(tx, tenantId, period, 4),
    )
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(third.ok).toBe(false)

    await withTenant(db, tenantId, (tx) => releaseQuota(tx, tenantId, period, 4))
    const snapshot = await withTenant(db, tenantId, (tx) =>
      getQuotaSnapshot(tx, tenantId, period),
    )
    expect(Number(snapshot?.reserved_cost_usd)).toBe(4)

    const again = await withTenant(db, tenantId, (tx) =>
      reserveQuota(tx, tenantId, period, 4),
    )
    expect(again.ok).toBe(true)
  })
})
