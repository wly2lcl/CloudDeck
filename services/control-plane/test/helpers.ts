import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database } from '@clouddeck/db'
import { createTestDb } from '@clouddeck/db/testing'
import { LocalStorage, type Storage } from '@clouddeck/storage'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/app'
import type { AppConfig } from '../src/config'
import { syncCapabilities } from '../src/registry'
import { MockMailer } from '../src/mailer'

export interface TestContext {
  app: FastifyInstance
  db: Database
  storage: Storage
  storageRoot: string
  config: AppConfig
  mailer: MockMailer
  cleanup(): Promise<void>
}

const CAPABILITIES_DIR = fileURLToPath(new URL('../../../capabilities/', import.meta.url))

export async function createTestContext(): Promise<TestContext> {
  const { db, close } = await createTestDb()
  const storageRoot = await mkdtemp(join(tmpdir(), 'clouddeck-test-'))
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    webOrigin: 'http://localhost:3000',
    authSecret: 'test-secret',
    credentialsKey: 'test-credentials-key',
    credentialsPreviousKey: 'old-credentials-key',
    publicApiBase: 'http://localhost:4310',
    capabilitiesDir: CAPABILITIES_DIR,
    databaseUrl: 'unused',
    storageLocalSecret: 'test-secret',
    storageDir: storageRoot,
    paymentProvider: 'mock',
    paymentSecret: 'test-payment-secret',
    pushProvider: 'mock',
    rateLimitMax: 10_000,
    exposeAuthTokens: true,
    platformAdminEmails: ['owner@example.com'],
    mailProvider: 'mock',
    mailFrom: 'CloudDeck <noreply@test.local>',
  }

  await syncCapabilities(db, CAPABILITIES_DIR)

  const storage = new LocalStorage({
    root: storageRoot,
    secret: config.storageLocalSecret,
    publicBase: config.publicApiBase,
  })
  const mailer = new MockMailer()
  const app = await buildServer({ db, storage, config, mailer })
  await app.ready()

  return {
    app,
    db,
    storage,
    storageRoot,
    config,
    mailer,
    async cleanup() {
      await app.close()
      await close()
      await rm(storageRoot, { recursive: true, force: true })
    },
  }
}

export function multipartFile(content: string, filename = 'sample.txt') {
  const boundary = '----clouddecktest'
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}
