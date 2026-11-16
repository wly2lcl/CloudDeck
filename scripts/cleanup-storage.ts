import { createDb, listAssetStorageKeys } from '@clouddeck/db'
import { createStorage } from '@clouddeck/storage'

/**
 * 清理对象存储中未被 asset_versions 引用的孤儿文件。
 * 默认 dry-run，加 --apply 才真正删除。
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgres://clouddeck:clouddeck@localhost:5432/clouddeck'
  const useS3 = Boolean(process.env.S3_BUCKET)
  const { db, close } = createDb(databaseUrl)

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

  const referenced = new Set(await listAssetStorageKeys(db))
  const keys = await storage.listKeys()
  const orphans = keys.filter((key) => !referenced.has(key))

  console.log(
    `对象总数 ${keys.length}，引用 ${referenced.size}，孤儿 ${orphans.length}${apply ? '（执行删除）' : '（dry-run）'}`,
  )
  for (const key of orphans.slice(0, 20)) console.log(`  ${key}`)
  if (orphans.length > 20) console.log(`  …还有 ${orphans.length - 20} 个`)

  if (apply) {
    for (const key of orphans) await storage.remove(key)
    console.log(`已删除 ${orphans.length} 个孤儿对象`)
  } else if (orphans.length > 0) {
    console.log('确认后加 --apply 执行删除')
  }

  await close()
}

main().catch((error) => {
  console.error('存储清理失败', error)
  process.exit(1)
})
