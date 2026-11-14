export interface AppConfig {
  port: number
  host: string
  webOrigin: string
}

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
  }
}
