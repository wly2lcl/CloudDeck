import { z } from 'zod'
import { assetTypeSchema } from './asset'

export const jobStatusSchema = z.enum([
  'queued',
  'provisioning',
  'running',
  'finalizing',
  'succeeded',
  'failed',
  'cancelled',
])

export type JobStatus = z.infer<typeof jobStatusSchema>

export const artifactSpecSchema = z.strictObject({
  name: z.string().min(1),
  type: assetTypeSchema,
  path: z.string().min(1),
  mime: z.string().min(1),
  meta: z.record(z.string(), z.unknown()).optional(),
})

export type ArtifactSpec = z.infer<typeof artifactSpecSchema>

export const jobEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
    at: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('progress'),
    percent: z.number().min(0).max(100),
    message: z.string().optional(),
    at: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('partial'),
    name: z.string().min(1),
    assetType: assetTypeSchema,
    path: z.string().min(1),
    index: z.number().int().nonnegative().optional(),
    at: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('artifact'),
    spec: artifactSpecSchema,
    at: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('usage'),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    chars: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative(),
    at: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('error'),
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    at: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('done'),
    at: z.iso.datetime(),
  }),
])

export type JobEvent = z.infer<typeof jobEventSchema>
