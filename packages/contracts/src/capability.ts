import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { assetTypeSchema } from './asset'

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const CAPABILITY_ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const MEMORY_RE = /^\d+(?:Mi|Gi)$/

export const capabilityCategorySchema = z.enum(['writing', 'script', 'audio', 'video', 'coding'])
export type CapabilityCategory = z.infer<typeof capabilityCategorySchema>

export const executionModeSchema = z.enum(['sync', 'async'])
export type ExecutionMode = z.infer<typeof executionModeSchema>

export const credentialPolicySchema = z.enum(['tenant', 'platform', 'either'])
export type CredentialPolicy = z.infer<typeof credentialPolicySchema>

export const driverKindSchema = z.enum(['agent-cli', 'acp', 'pipeline', 'llm'])
export type DriverKind = z.infer<typeof driverKindSchema>

export const inputSpecSchema = z.strictObject({
  name: z.string().min(1),
  label: z.string().min(1).optional(),
  assetTypes: z.array(assetTypeSchema).min(1),
  required: z.boolean().default(true),
})

export const outputSpecSchema = z.strictObject({
  name: z.string().min(1),
  assetType: assetTypeSchema,
  multiple: z.boolean().default(false),
})

export const executionSpecSchema = z.strictObject({
  mode: executionModeSchema,
  resumable: z.boolean().default(false),
  maxDurationMs: z.number().int().positive(),
  maxCostUsd: z.number().positive(),
  concurrency: z.number().int().positive().default(1),
})

export const credentialsSpecSchema = z.strictObject({
  policy: credentialPolicySchema.default('tenant'),
})

export const routingRuleSchema = z.strictObject({
  when: z.record(z.string(), z.unknown()).optional(),
  driver: z.string().min(1),
})

export const driverSpecSchema = z.strictObject({
  kind: driverKindSchema,
  ref: z.string().min(1),
  routing: z
    .array(routingRuleSchema)
    .min(1)
    .refine((rules) => rules.some((rule) => rule.when === undefined), {
      message: 'routing 必须包含一个无 when 的默认项',
    }),
})

export const permissionsSpecSchema = z.strictObject({
  network: z.array(z.string().min(1)).default([]),
  filesystem: z.literal('workspace-only').default('workspace-only'),
  secrets: z.array(z.string().min(1)).default([]),
  allowShell: z.boolean().default(false),
})

export const resourcesSpecSchema = z.strictObject({
  cpu: z.number().positive().default(1),
  memory: z.string().regex(MEMORY_RE, '内存格式应为 512Mi 或 4Gi').default('1Gi'),
  gpu: z.enum(['none', 'optional', 'required']).default('none'),
})

export const billingSpecSchema = z.strictObject({
  unit: z.enum(['per_1k_chars', 'per_token', 'per_minute', 'per_job']),
  priceKey: z.string().min(1),
  estimate: z.number().nonnegative(),
})

export const uiSpecSchema = z.strictObject({
  form: z.string().min(1),
  result: z.string().min(1),
  preview: z.string().min(1).optional(),
})

export const promptsSpecSchema = z
  .strictObject({
    system: z.string().min(1).optional(),
  })
  .optional()

export const capabilityManifestSchema = z.strictObject({
  id: z.string().regex(CAPABILITY_ID_RE, 'id 应为小写点分格式，如 audiobook.render'),
  version: z.string().regex(SEMVER_RE, 'version 应为 semver'),
  name: z.string().min(1),
  description: z.string().min(1),
  category: capabilityCategorySchema,
  icon: z.string().min(1).optional(),
  inputs: z.array(inputSpecSchema).min(1),
  outputs: z.array(outputSpecSchema).min(1),
  execution: executionSpecSchema,
  credentials: credentialsSpecSchema,
  driver: driverSpecSchema,
  permissions: permissionsSpecSchema,
  resources: resourcesSpecSchema,
  billing: billingSpecSchema,
  ui: uiSpecSchema,
  prompts: promptsSpecSchema,
  tags: z.array(z.string().min(1)).default([]),
})

export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>
export type InputSpec = z.infer<typeof inputSpecSchema>
export type OutputSpec = z.infer<typeof outputSpecSchema>
export type DriverSpec = z.infer<typeof driverSpecSchema>
export type RoutingRule = z.infer<typeof routingRuleSchema>

export interface ManifestIssue {
  path: string
  message: string
}

export class ManifestValidationError extends Error {
  readonly issues: ManifestIssue[]

  constructor(issues: ManifestIssue[]) {
    super(
      `能力 manifest 校验失败：${issues.map((issue) => `${issue.path || '<root>'}: ${issue.message}`).join('; ')}`,
    )
    this.name = 'ManifestValidationError'
    this.issues = issues
  }
}

export function validateCapabilityManifest(input: unknown) {
  return capabilityManifestSchema.safeParse(input)
}

export function parseCapabilityManifest(source: string): CapabilityManifest {
  const result = capabilityManifestSchema.safeParse(parseYaml(source))
  if (!result.success) {
    throw new ManifestValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    )
  }
  return result.data
}
