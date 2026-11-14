import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers'

let handle: TestDb | null = null

async function seed() {
  handle = await createTestDb()
  const { db } = handle
  const tenantA = '11111111-1111-4111-8111-111111111111'
  const tenantB = '22222222-2222-4222-8222-222222222222'
  const projectA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const projectB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  await db.execute(sql`
    INSERT INTO tenants (id, name, slug) VALUES
      (${tenantA}, 'A', 'tenant-a'),
      (${tenantB}, 'B', 'tenant-b')
  `)
  await db.execute(sql`
    INSERT INTO projects (id, tenant_id, name) VALUES
      (${projectA}, ${tenantA}, 'A 项目'),
      (${projectB}, ${tenantB}, 'B 项目')
  `)

  return { tenantA, tenantB, projectA, projectB }
}

afterEach(async () => {
  await handle?.close()
  handle = null
})

describe('Row Level Security', () => {
  it('非所有者角色只能看到当前租户数据', async () => {
    const { tenantA, projectA } = await seed()
    if (!handle) throw new Error('db not ready')

    await handle.client.exec('SET ROLE clouddeck_app')
    await handle.client.exec(`SELECT set_config('app.tenant_id', '${tenantA}', false)`)

    const result = (await handle.db.execute(sql`SELECT id FROM projects`)) as unknown as {
      rows: { id: string }[]
    }
    expect(result.rows.map((row) => row.id)).toEqual([projectA])

    await handle.client.exec('RESET ROLE')
  })

  it('未设置租户上下文时看不到任何行', async () => {
    await seed()
    if (!handle) throw new Error('db not ready')

    await handle.client.exec('SET ROLE clouddeck_app')
    await handle.client.exec(`SELECT set_config('app.tenant_id', '', false)`)

    const result = (await handle.db.execute(sql`SELECT id FROM projects`)) as unknown as {
      rows: { id: string }[]
    }
    expect(result.rows).toHaveLength(0)

    await handle.client.exec('RESET ROLE')
  })

  it('跨租户写入被策略拒绝', async () => {
    const { tenantA, projectB } = await seed()
    if (!handle) throw new Error('db not ready')

    await handle.client.exec('SET ROLE clouddeck_app')
    await handle.client.exec(`SELECT set_config('app.tenant_id', '${tenantA}', false)`)

    await expect(
      handle.db.execute(sql`UPDATE projects SET name = 'hacked' WHERE id = ${projectB}`),
    ).resolves.toBeDefined()

    const check = (await handle.db.execute(
      sql`SELECT name FROM projects WHERE id = ${projectB}`,
    )) as unknown as { rows: { name: string }[] }
    expect(check.rows).toHaveLength(0)

    await handle.client.exec('RESET ROLE')
  })
})
