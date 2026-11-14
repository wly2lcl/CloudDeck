import { createModelCredential, createTenant, listModelCredentials } from '@clouddeck/db'
import { createTestDb } from '@clouddeck/db/testing'
import { deriveMasterKey, encryptSecret } from '@clouddeck/secrets'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSecretEnv } from '../src/runner'

let close: (() => Promise<void>) | null = null

afterEach(async () => {
  await close?.()
  close = null
})

describe('租户密钥解析', () => {
  it('环境变量缺失时使用租户加密凭据', async () => {
    const handle = await createTestDb()
    close = handle.close
    const tenant = await createTenant(handle.db, { name: '凭据租户', slug: `t-${Date.now()}` })
    const masterKey = deriveMasterKey('master-key')

    await createModelCredential(handle.db, {
      tenantId: tenant.id,
      provider: 'dashscope',
      label: '百炼',
      encryptedSecret: encryptSecret('sk-dashscope-secret', masterKey),
      keyHint: '****cret',
    })

    const env = await resolveSecretEnv(
      { db: handle.db, env: {}, credentialsKey: 'master-key' },
      tenant.id,
      ['DASHSCOPE_API_KEY'],
    )
    expect(env.DASHSCOPE_API_KEY).toBe('sk-dashscope-secret')

    const rows = await listModelCredentials(handle.db, tenant.id)
    expect(rows[0]?.last_used_at).not.toBeNull()
  })

  it('进程环境优先于租户凭据', async () => {
    const handle = await createTestDb()
    close = handle.close
    const tenant = await createTenant(handle.db, { name: '优先级租户', slug: `t-${Date.now()}` })
    const masterKey = deriveMasterKey('master-key')

    await createModelCredential(handle.db, {
      tenantId: tenant.id,
      provider: 'dashscope',
      label: '百炼',
      encryptedSecret: encryptSecret('from-credential', masterKey),
      keyHint: '****ial',
    })

    const env = await resolveSecretEnv(
      { db: handle.db, env: { DASHSCOPE_API_KEY: 'from-env' }, credentialsKey: 'master-key' },
      tenant.id,
      ['DASHSCOPE_API_KEY'],
    )
    expect(env.DASHSCOPE_API_KEY).toBe('from-env')
  })
})
