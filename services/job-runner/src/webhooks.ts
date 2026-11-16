import { createHmac } from 'node:crypto'
import {
  createWebhookDelivery,
  finishWebhookDelivery,
  listEnabledWebhooks,
  type Database,
  type JobRow,
} from '@clouddeck/db'

export interface WebhookDispatchOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export async function dispatchJobWebhooks(
  db: Database,
  job: JobRow,
  event: string,
  payload: Record<string, unknown>,
  options: WebhookDispatchOptions = {},
): Promise<void> {
  const hooks = await listEnabledWebhooks(db, job.tenant_id, event)
  if (hooks.length === 0) return

  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const maxAttempts = options.maxAttempts ?? 3

  for (const hook of hooks) {
    const delivery = await createWebhookDelivery(db, {
      tenantId: job.tenant_id,
      webhookId: hook.id,
      event,
      payload: { jobId: job.id, ...payload },
    })

    const body = JSON.stringify({ event, jobId: job.id, ...payload })
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = signWebhook(hook.secret, timestamp, body)

    let attempts = 0
    let lastError: string | null = null
    let delivered = false

    while (attempts < maxAttempts && !delivered) {
      attempts += 1
      try {
        const response = await fetchImpl(hook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-clouddeck-event': event,
            'x-clouddeck-timestamp': timestamp,
            'x-clouddeck-signature': signature,
          },
          body,
        })
        if (response.ok) delivered = true
        else lastError = `HTTP ${response.status}`
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      if (!delivered && attempts < maxAttempts) await sleep(200 * attempts)
    }

    await finishWebhookDelivery(db, {
      deliveryId: delivery.id,
      status: delivered ? 'delivered' : 'failed',
      attempts,
      lastError,
    })
  }
}
