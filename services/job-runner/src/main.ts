import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createDb } from '@clouddeck/db'
import { createCommandRunner } from '@clouddeck/sandbox'
import { createStorage } from '@clouddeck/storage'
import { startWorker } from './runner'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgres://clouddeck:clouddeck@localhost:5432/clouddeck'
  const { db, close } = createDb(databaseUrl)

  const useS3 = Boolean(process.env.S3_BUCKET)
  const storage = createStorage({
    driver: useS3 ? 's3' : 'local',
    localRoot: process.env.STORAGE_DIR ?? '.data/storage',
    secret: process.env.STORAGE_LOCAL_SECRET ?? process.env.AUTH_SECRET ?? 'dev-secret-change-me',
    publicBase: process.env.PUBLIC_API_BASE ?? 'http://localhost:4310',
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

  const commands =
    process.env.SANDBOX_DRIVER === 'docker'
      ? createCommandRunner({
          driver: 'docker',
          image: process.env.SANDBOX_IMAGE ?? 'node:22-alpine',
          workspaceRoot: process.env.SANDBOX_WORKSPACE_ROOT ?? tmpdir(),
          network: process.env.SANDBOX_NETWORK === 'bridge' ? 'bridge' : 'none',
          memory: process.env.SANDBOX_MEMORY ?? '2g',
          cpus: Number(process.env.SANDBOX_CPUS ?? 2),
        })
      : createCommandRunner({ driver: 'local' })

  const stop = await startWorker({
    db,
    storage,
    commands,
    capabilitiesDir: process.env.CAPABILITIES_DIR ?? `${REPO_ROOT}capabilities`,
    workspaceRoot: process.env.WORKSPACE_ROOT ?? tmpdir(),
    credentialsKey: process.env.CREDENTIALS_KEY ?? process.env.AUTH_SECRET,
    env: process.env,
  })
  console.log('job-runner 已启动')

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`job-runner 收到 ${signal}，正在停止`)
    stop()
    await close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  console.error('job-runner 启动失败', error)
  process.exit(1)
})
