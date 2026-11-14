import { pathToFileURL } from 'node:url'
import { createDb, migrate } from '@clouddeck/db'
import { createStorage } from '@clouddeck/storage'
import { buildServer } from './app'
import { loadConfig } from './config'
import { syncCapabilities } from './registry'

async function main(): Promise<void> {
  const config = loadConfig()
  const { db, close } = createDb(config.databaseUrl)

  await migrate(db)

  const sync = await syncCapabilities(db, config.capabilitiesDir)
  if (sync.errors.length > 0) {
    for (const error of sync.errors) {
      console.error(`能力加载失败 ${error.directory}: ${error.message}`)
    }
    await close()
    process.exit(1)
  }
  console.log(`已加载能力: ${sync.loaded.join(', ') || '(无)'}`)

  const useS3 = Boolean(process.env.S3_BUCKET)
  const storage = createStorage({
    driver: useS3 ? 's3' : 'local',
    localRoot: config.storageDir,
    secret: config.storageLocalSecret,
    publicBase: config.publicApiBase,
    s3: useS3
      ? {
          endpoint: process.env.S3_ENDPOINT,
          region: process.env.S3_REGION ?? 'us-east-1',
          bucket: process.env.S3_BUCKET ?? 'clouddeck',
          accessKeyId: process.env.S3_ACCESS_KEY ?? '',
          secretAccessKey: process.env.S3_SECRET_KEY ?? '',
          forcePathStyle: true,
        }
      : undefined,
  })

  const app = buildServer({ db, storage, config }, { logger: true })

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, '正在关闭控制面')
    await app.close()
    await close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ port: config.port, host: config.host })
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error('控制面启动失败', error)
    process.exit(1)
  })
}
