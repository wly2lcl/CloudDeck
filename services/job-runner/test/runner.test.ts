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

describe('工作区清理', () => {
  it('只删除超过 TTL 的任务目录', async () => {
    const { mkdir, utimes, stat } = await import('node:fs/promises')
    const { cleanupWorkspaces } = await import('../src/runner')
    const root = await mkdtemp(join(tmpdir(), 'clouddeck-cleanup-'))
    const oldDir = join(root, 'clouddeck-job-old')
    const freshDir = join(root, 'clouddeck-job-fresh')
    const otherDir = join(root, 'keep-me')
    await mkdir(oldDir)
    await mkdir(freshDir)
    await mkdir(otherDir)

    const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await utimes(oldDir, old, old)
    await utimes(otherDir, old, old)

    const removed = await cleanupWorkspaces(root, 24 * 60 * 60 * 1000)
    expect(removed).toBe(1)
    await expect(stat(oldDir)).rejects.toThrow()
    expect((await stat(freshDir)).isDirectory()).toBe(true)
    expect((await stat(otherDir)).isDirectory()).toBe(true)

    await rm(root, { recursive: true, force: true })
  })
})
