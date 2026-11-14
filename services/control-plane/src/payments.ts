import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AppConfig } from './config'

export type PaidTier = 'pro' | 'team'

export interface CheckoutInput {
  tenantId: string
  tier: PaidTier
  successUrl?: string
  cancelUrl?: string
}

export interface CheckoutResult {
  url: string
  externalId: string
}

export interface WebhookResult {
  externalId: string
  status: 'paid' | 'failed'
  tier?: PaidTier
}

export interface PaymentProvider {
  readonly name: string
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>
  parseWebhook(headers: Record<string, unknown>, body: unknown): WebhookResult
}

export const PLAN_PRICES: Record<PaidTier, number> = { pro: 29, team: 299 }

function verifySignature(secret: string, body: unknown, signature: unknown): boolean {
  if (typeof signature !== 'string') return false
  const expected = createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex')
  const left = Buffer.from(expected)
  const right = Buffer.from(signature)
  return left.length === right.length && timingSafeEqual(left, right)
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock'

  constructor(
    private readonly secret: string,
    private readonly publicBase: string,
  ) {}

  async createCheckout(_input: CheckoutInput): Promise<CheckoutResult> {
    const externalId = `mock_${randomUUID()}`
    const url = `${this.publicBase}/mock-checkout?externalId=${externalId}`
    return { url, externalId }
  }

  parseWebhook(headers: Record<string, unknown>, body: unknown): WebhookResult {
    if (!verifySignature(this.secret, body, headers['x-payment-signature'])) {
      throw new Error('支付回调签名无效')
    }
    const payload = body as Partial<WebhookResult>
    if (!payload.externalId || (payload.status !== 'paid' && payload.status !== 'failed')) {
      throw new Error('支付回调载荷非法')
    }
    return payload as WebhookResult
  }
}

export class HttpPaymentProvider implements PaymentProvider {
  readonly name = 'http'

  constructor(
    private readonly options: {
      url: string
      token?: string
      secret: string
      publicBase: string
    },
  ) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const response = await fetch(this.options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
      },
      body: JSON.stringify({
        tenantId: input.tenantId,
        tier: input.tier,
        amountUsd: PLAN_PRICES[input.tier],
        successUrl: input.successUrl ?? `${this.options.publicBase}/settings`,
        cancelUrl: input.cancelUrl ?? `${this.options.publicBase}/settings`,
      }),
    })
    if (!response.ok) throw new Error(`支付服务返回 ${response.status}`)
    const payload = (await response.json()) as Partial<CheckoutResult>
    if (!payload.url || !payload.externalId) throw new Error('支付服务未返回 checkout')
    return { url: payload.url, externalId: payload.externalId }
  }

  parseWebhook(headers: Record<string, unknown>, body: unknown): WebhookResult {
    if (!verifySignature(this.options.secret, body, headers['x-payment-signature'])) {
      throw new Error('支付回调签名无效')
    }
    const payload = body as Partial<WebhookResult>
    if (!payload.externalId || (payload.status !== 'paid' && payload.status !== 'failed')) {
      throw new Error('支付回调载荷非法')
    }
    return payload as WebhookResult
  }
}

export function createPaymentProvider(config: AppConfig): PaymentProvider {
  if (config.paymentProvider === 'http' && config.paymentHttpUrl) {
    return new HttpPaymentProvider({
      url: config.paymentHttpUrl,
      token: config.paymentHttpToken,
      secret: config.paymentSecret,
      publicBase: config.publicApiBase,
    })
  }
  return new MockPaymentProvider(config.paymentSecret, config.publicApiBase)
}
