import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import type { Database } from './client'

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))

interface RawClient {
  exec?: (sqlText: string) => Promise<unknown>
  query?: (sqlText: string) => Promise<unknown>
}

/**
 * 迁移脚本包含 DO $$ ... $$ 与多条语句，不能用预处理语句执行。
 * node-postgres 走 Pool.query 的简单查询协议，pglite 走 exec。
 */
async function execRaw(db: Database, sqlText: string): Promise<void> {
  const client = (db as unknown as { $client?: RawClient }).$client
  if (client?.exec) {
    await client.exec(sqlText)
    return
  }
  if (client?.query) {
    await client.query(sqlText)
    return
  }
  throw new Error('无法识别数据库驱动，迁移中止')
}

export async function migrate(db: Database): Promise<string[]> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const applied = new Set(
    (
      (await db.execute(sql`SELECT version FROM schema_migrations`)) as unknown as {
        rows: { version: string }[]
      }
    ).rows.map((row) => row.version),
  )

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  const newlyApplied: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const body = readFileSync(MIGRATIONS_DIR + file, 'utf8')
    const version = file.replaceAll("'", "''")
    await execRaw(
      db,
      `${body}\nINSERT INTO schema_migrations (version) VALUES ('${version}');`,
    )
    newlyApplied.push(file)
  }

  return newlyApplied
}
