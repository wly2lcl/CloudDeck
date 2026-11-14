import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type { Database } from './client'
import { migrate } from './migrate'
import { schema } from './schema'

export interface TestDb {
  db: Database
  client: PGlite
  close(): Promise<void>
}

/** 仅用于测试：进程内 Postgres（PGlite）并应用全部迁移。 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzle(client, { schema }) as unknown as Database
  await migrate(db)
  return {
    db,
    client,
    async close() {
      await client.close()
    },
  }
}
