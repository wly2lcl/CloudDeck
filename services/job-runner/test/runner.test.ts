import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '@clouddeck/db/testing'
import { LocalStorage } from '@clouddeck/storage'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOnce } from '../src/runner'

let close: () => Promise<void>
let storageRoot = ''
let deps: Parameters<typeof runOnce>[0]

beforeAll(async () => {
  const handle = await createTestDb()
  close = handle.close
  storageRoot = await mkdtemp(join(tmpdir(), 'clouddeck-runner-'))
  deps = {
    db: handle.db,
    storage: new LocalStorage({
      root: storageRoot,
      secret: 'test',
      publicBase: 'http://localhost:4310',
    }),
  }
})

afterAll(async () => {
  await close()
  await rm(storageRoot, { recursive: true, force: true })
})

describe('job-runner', () => {
  it('队列为空时返回 null 且不报错', async () => {
    await expect(runOnce(deps)).resolves.toBeNull()
  })
})
