import { fileURLToPath } from 'node:url'

export interface AppConfig {
  port: number
  host: string
  webOrigin: string
  authSecret: string
  credentialsKey: string
  credentialsPreviousKey?: string
  publicApiBase: string
  capabilitiesDir: string
  databaseUrl: string
  storageLocalSecret: string
  storageDir: string
  paymentProvider: 'mock' | 'http'
  paymentSecret: string
  paymentHttpUrl?: string
  paymentHttpToken?: string
  pushProvider: 'mock' | 'http'
  pushHttpUrl?: string
  pushHttpToken?: string
  rateLimitMax: number
  exposeAuthTokens: boolean
  platformAdminEmails: string[]
  mailProvider: 'mock' | 'http'
  mailHttpUrl?: string
  mailHttpToken?: string
  mailFrom: string
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env.CONTROL_PLANE_PORT ?? env.PORT ?? '4310'
  const port = Number.parseInt(rawPort, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`端口配置非法: ${rawPort}`)
  }

  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:3000',
    authSecret: env.AUTH_SECRET ?? 'dev-secret-change-me',
    credentialsKey: env.CREDENTIALS_KEY ?? env.AUTH_SECRET ?? 'dev-secret-change-me',
    credentialsPreviousKey: env.CREDENTIALS_KEY_PREVIOUS,
    publicApiBase: env.PUBLIC_API_BASE ?? `http://localhost:${port}`,
    capabilitiesDir: env.CAPABILITIES_DIR ?? `${REPO_ROOT}capabilities`,
    databaseUrl:
      env.DATABASE_URL ?? 'postgres://clouddeck:clouddeck@localhost:5432/clouddeck',
    storageLocalSecret: env.STORAGE_LOCAL_SECRET ?? env.AUTH_SECRET ?? 'dev-secret-change-me',
    storageDir: env.STORAGE_DIR ?? `${REPO_ROOT}.data/storage`,
    paymentProvider: env.PAYMENT_PROVIDER === 'http' ? 'http' : 'mock',
    paymentSecret: env.PAYMENT_WEBHOOK_SECRET ?? env.AUTH_SECRET ?? 'dev-secret-change-me',
    paymentHttpUrl: env.PAYMENT_HTTP_URL,
    paymentHttpToken: env.PAYMENT_HTTP_TOKEN,
    pushProvider: env.PUSH_PROVIDER === 'http' ? 'http' : 'mock',
    pushHttpUrl: env.PUSH_HTTP_URL,
    pushHttpToken: env.PUSH_HTTP_TOKEN,
    rateLimitMax: Number(env.RATE_LIMIT_MAX ?? 300),
    exposeAuthTokens: env.AUTH_EXPOSE_TOKENS === 'true',
    platformAdminEmails: (env.PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
    mailProvider: env.MAIL_PROVIDER === 'http' ? 'http' : 'mock',
    mailHttpUrl: env.MAIL_HTTP_URL,
    mailHttpToken: env.MAIL_HTTP_TOKEN,
    mailFrom: env.MAIL_FROM ?? 'CloudDeck <noreply@clouddeck.local>',
  }
}
