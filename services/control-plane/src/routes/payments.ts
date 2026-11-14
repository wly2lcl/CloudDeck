import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createPayment,
  getPaymentByExternalId,
  listPayments,
  updatePaymentStatus,
  updateTenantPlan,
  withTenant,
  type TenantTier,
} from '@clouddeck/db'
import { requireAuth, requireRole } from '../auth'
import type { AppDeps } from '../deps'
import { AppError } from '../errors'
import { createPaymentProvider, PLAN_PRICES } from '../payments'
import { toIso } from '../time'
import { ok, param, parseBody } from './helpers'

const checkoutSchema = z.object({ tier: z.enum(['pro', 'team']) })

export function registerPaymentRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.post('/v1/billing/checkout', { preHandler: guard }, async (request) => {
    const auth = requireRole(request, ['owner', 'admin'])
    const body = parseBody(checkoutSchema, request.body)
    const provider = createPaymentProvider(deps.config)

    const checkout = await provider.createCheckout({
      tenantId: auth.tenantId,
      tier: body.tier,
    })

    const payment = await withTenant(deps.db, auth.tenantId, (tx) =>
      createPayment(tx, {
        tenantId: auth.tenantId,
        provider: provider.name,
        externalId: checkout.externalId,
        tier: body.tier,
        amountUsd: PLAN_PRICES[body.tier],
      }),
    )

    return ok(request, {
      id: payment.id,
      url: checkout.url,
      externalId: checkout.externalId,
      tier: payment.tier,
      amountUsd: Number(payment.amount_usd),
      status: payment.status,
    })
  })

  app.post('/v1/billing/webhook/:provider', async (request) => {
    const provider = createPaymentProvider(deps.config)
    if (param(request, 'provider') !== provider.name) {
      throw new AppError('NOT_FOUND', '支付渠道不存在')
    }

    let result
    try {
      result = provider.parseWebhook(request.headers, request.body)
    } catch (error) {
      throw new AppError(
        'FORBIDDEN',
        error instanceof Error ? error.message : '支付回调校验失败',
      )
    }

    const payment = await getPaymentByExternalId(deps.db, provider.name, result.externalId)
    if (!payment) throw new AppError('NOT_FOUND', '支付单不存在')

    await withTenant(deps.db, payment.tenant_id, async (tx) => {
      await updatePaymentStatus(tx, payment.id, result.status)
      if (result.status === 'paid') {
        const tier = (result.tier ?? payment.tier) as TenantTier
        await updateTenantPlan(tx, payment.tenant_id, tier)
      }
    })

    return { data: { received: true }, requestId: request.id }
  })

  app.get('/v1/billing/payments', { preHandler: guard }, async (request) => {
    const auth = requireAuth(request)
    const payments = await withTenant(deps.db, auth.tenantId, (tx) =>
      listPayments(tx, auth.tenantId),
    )
    return ok(
      request,
      payments.map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        tier: payment.tier,
        amountUsd: Number(payment.amount_usd),
        status: payment.status,
        createdAt: toIso(payment.created_at),
      })),
    )
  })
}
