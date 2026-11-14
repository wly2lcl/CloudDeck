import { sql, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import { schema } from './schema'

// 兼容 node-postgres 与 pglite 两种驱动；查询统一走 execute 与参数化 SQL。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = PgDatabase<any, typeof schema>

export interface DbHandle {
  db: Database
  pool: Pool
  close(): Promise<void>
}

export function createDb(databaseUrl: string): DbHandle {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 })
  const db = drizzle(pool, { schema })
  return {
    db,
    pool,
    async close() {
      await pool.end()
    },
  }
}

export async function rows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] }
  return result.rows
}

export async function one<T>(db: Database, query: SQL): Promise<T | null> {
  const result = await rows<T>(db, query)
  return result[0] ?? null
}

export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    return fn(tx as unknown as Database)
  })
}
