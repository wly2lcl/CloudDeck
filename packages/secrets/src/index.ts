import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto'

const VERSION = 'v1'
const SALT = 'clouddeck-credentials-v1'

/** 从主密钥派生 32 字节 AES key。生产应通过 CREDENTIALS_KEY 注入高熵随机值。 */
export function deriveMasterKey(secret: string): Buffer {
  return scryptSync(secret, SALT, 32)
}

export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':')
}

export function decryptSecret(payload: string, masterKey: Buffer): string {
  const [version, ivValue, tagValue, dataValue] = payload.split(':')
  if (version !== VERSION || !ivValue || !tagValue || !dataValue) {
    throw new Error('凭据密文格式非法')
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivValue, 'base64'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataValue, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function keyHint(secret: string): string {
  return secret.length <= 4 ? '****' : `****${secret.slice(-4)}`
}
