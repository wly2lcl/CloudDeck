import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
  listKeys(prefix?: string): Promise<string[]>
  signedDownloadUrl(key: string, ttlSeconds: number): Promise<string>
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`非法存储键: ${key}`)
  }
}

export interface LocalStorageOptions {
  root: string
  secret: string
  publicBase: string
}

export class LocalStorage implements Storage {
  private readonly root: string

  constructor(private readonly options: LocalStorageOptions) {
    this.root = resolve(options.root)
  }

  private pathOf(key: string): string {
    assertSafeKey(key)
    const full = normalize(join(this.root, key))
    if (!full.startsWith(this.root)) throw new Error('存储键越界')
    return full
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key))
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true })
  }

  async listKeys(prefix = ''): Promise<string[]> {
    const keys: string[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.isFile()) {
          const key = full.slice(this.root.length + 1).split('\\').join('/')
          if (key.startsWith(prefix)) keys.push(key)
        }
      }
    }
    await walk(this.root)
    return keys.sort()
  }

  async signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key)
    const exp = Date.now() + ttlSeconds * 1000
    const sig = signLocal(this.options.secret, key, exp)
    const base = this.options.publicBase.replace(/\/$/, '')
    return `${base}/v1/storage/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`
  }
}

export function signLocal(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret).update(`${key}:${exp}`).digest('hex')
}

export function verifyLocalSignature(
  secret: string,
  key: string,
  exp: number,
  signature: string,
): boolean {
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  const expected = Buffer.from(signLocal(secret, key, exp))
  const provided = Buffer.from(signature)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

export interface S3StorageOptions {
  endpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean
}

export class S3Storage implements Storage {
  private readonly client: S3Client

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    })
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    )
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key)
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
    )
    if (!response.Body) throw new Error(`对象不存在: ${key}`)
    return Buffer.from(await response.Body.transformToByteArray())
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }))
  }

  async listKeys(prefix = ''): Promise<string[]> {
    const keys: string[] = []
    let token: string | undefined
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      )
      for (const item of response.Contents ?? []) {
        if (item.Key) keys.push(item.Key)
      }
      token = response.NextContinuationToken
    } while (token)
    return keys
  }

  async signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key)
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    )
  }
}

export interface StorageConfig {
  driver: 'local' | 's3'
  localRoot: string
  secret: string
  publicBase: string
  s3?: S3StorageOptions
}

export function createStorage(config: StorageConfig): Storage {
  if (config.driver === 's3') {
    if (!config.s3) throw new Error('S3 存储配置缺失')
    return new S3Storage(config.s3)
  }
  return new LocalStorage({
    root: config.localRoot,
    secret: config.secret,
    publicBase: config.publicBase,
  })
}

export function storageKeyFor(
  tenantId: string,
  projectId: string,
  assetId: string,
  version: number,
  filename: string,
): string {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_')
  return `t/${tenantId}/p/${projectId}/${assetId}/v${version}/${safeName}`
}
