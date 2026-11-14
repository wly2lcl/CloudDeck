import { fileURLToPath } from 'node:url'

export interface AppConfig {
  port: number
  host: string
  webOrigin: string
  authSecret: string
  publicApiBase: string
  capabilitiesDir: string
  databaseUrl: string
  storageLocalSecret: string
  storageDir: string
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
    publicApiBase: env.PUBLIC_API_BASE ?? `http://localhost:${port}`,
    capabilitiesDir: env.CAPABILITIES_DIR ?? `${REPO_ROOT}capabilities`,
    databaseUrl:
      env.DATABASE_URL ?? 'postgres://clouddeck:clouddeck@localhost:5432/clouddeck',
    storageLocalSecret: env.STORAGE_LOCAL_SECRET ?? env.AUTH_SECRET ?? 'dev-secret-change-me',
    storageDir: env.STORAGE_DIR ?? `${REPO_ROOT}.data/storage`,
  }
}
