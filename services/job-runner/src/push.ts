import { listDeviceTokens, type Database, type JobRow } from '@clouddeck/db'

export interface PushOptions {
  provider?: 'mock' | 'http'
  url?: string
  token?: string
  fetchImpl?: typeof fetch
}

export interface PushMessage {
  title: string
  body: string
  event: string
}

export async function dispatchJobPush(
  db: Database,
  job: JobRow,
  message: PushMessage,
  options: PushOptions = {},
): Promise<void> {
  const devices = await listDeviceTokens(db, job.tenant_id)
  if (devices.length === 0) return

  const payload = {
    tokens: devices.map((device) => device.token),
    title: message.title,
    body: message.body,
    data: { event: message.event, jobId: job.id },
  }

  if (options.provider === 'http' && options.url) {
    const response = await (options.fetchImpl ?? fetch)(options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`推送服务返回 ${response.status}`)
    return
  }

  console.log(`[push:mock] ${message.title} -> ${devices.length} devices`, payload.data)
}
