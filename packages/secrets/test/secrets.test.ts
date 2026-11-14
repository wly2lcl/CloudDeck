import { describe, expect, it } from 'vitest'
import { decryptSecret, deriveMasterKey, encryptSecret, keyHint } from '../src/index'

describe('凭据加密', () => {
  const key = deriveMasterKey('test-master-key')

  it('加密后可解密', () => {
    const encrypted = encryptSecret('sk-secret-value', key)
    expect(encrypted).not.toContain('sk-secret-value')
    expect(decryptSecret(encrypted, key)).toBe('sk-secret-value')
  })

  it('错误密钥无法解密', () => {
    const encrypted = encryptSecret('sk-secret-value', key)
    const wrong = deriveMasterKey('another-key')
    expect(() => decryptSecret(encrypted, wrong)).toThrow()
  })

  it('篡改密文会被 GCM 拒绝', () => {
    const encrypted = encryptSecret('sk-secret-value', key)
    const parts = encrypted.split(':')
    parts[3] = Buffer.from('tampered').toString('base64')
    expect(() => decryptSecret(parts.join(':'), key)).toThrow()
  })

  it('生成末四位提示', () => {
    expect(keyHint('sk-1234567890')).toBe('****7890')
    expect(keyHint('abc')).toBe('****')
  })
})
