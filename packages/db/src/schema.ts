import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

const now = sql`now()`

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  tier: text('tier').notNull().default('free'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('zh-CN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
})

export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.userId] })],
)

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  refreshTokenHash: text('refresh_token_hash').notNull().unique(),
  device: text('device'),
  ip: text('ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
})

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    coverAssetId: uuid('cover_asset_id'),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('projects_tenant_created_idx').on(table.tenantId, table.createdAt)],
)

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    meta: jsonb('meta').notNull().default({}),
    latestVersion: integer('latest_version').notNull().default(1),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [index('assets_tenant_project_idx').on(table.tenantId, table.projectId, table.type)],
)

export const assetVersions = pgTable(
  'asset_versions',
  {
    tenantId: uuid('tenant_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    version: integer('version').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    meta: jsonb('meta').notNull().default({}),
    createdByJobId: uuid('created_by_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.version] })],
)

export const assetLinks = pgTable(
  'asset_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    fromAssetId: uuid('from_asset_id').notNull(),
    fromVersion: integer('from_version').notNull(),
    toAssetId: uuid('to_asset_id').notNull(),
    toVersion: integer('to_version').notNull(),
    relation: text('relation').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index('asset_links_from_idx').on(table.tenantId, table.fromAssetId),
    index('asset_links_to_idx').on(table.tenantId, table.toAssetId),
  ],
)

export const capabilities = pgTable(
  'capabilities',
  {
    id: text('id').notNull(),
    version: text('version').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    manifest: jsonb('manifest').notNull(),
    status: text('status').notNull().default('active'),
    driverDefault: text('driver_default').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.id, table.version] })],
)

export const capabilityDrivers = pgTable(
  'capability_drivers',
  {
    capabilityId: text('capability_id').notNull(),
    driverId: text('driver_id').notNull(),
    priority: integer('priority').notNull().default(0),
    config: jsonb('config').notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.capabilityId, table.driverId] })],
)

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    capabilityId: text('capability_id').notNull(),
    capabilityVersion: text('capability_version').notNull(),
    status: text('status').notNull().default('queued'),
    driverId: text('driver_id').notNull(),
    params: jsonb('params').notNull().default({}),
    inputAssets: jsonb('input_assets').notNull().default([]),
    outputAssets: jsonb('output_assets').notNull().default([]),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    actualCostUsd: numeric('actual_cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    retriedFromJobId: uuid('retried_from_job_id'),
    resumeCount: integer('resume_count').notNull().default(0),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    attempts: integer('attempts').notNull().default(0),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    createdBy: uuid('created_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index('jobs_tenant_status_idx').on(table.tenantId, table.status),
    index('jobs_claim_idx').on(table.status, table.createdAt),
  ],
)

export const jobEvents = pgTable(
  'job_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    jobId: uuid('job_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [index('job_events_job_seq_idx').on(table.jobId, table.seq)],
)

export const jobArtifacts = pgTable('job_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  assetId: uuid('asset_id').notNull(),
  version: integer('version').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
})

export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    jobId: uuid('job_id'),
    capabilityId: text('capability_id').notNull(),
    driverId: text('driver_id').notNull(),
    unit: text('unit').notNull(),
    quantity: numeric('quantity', { precision: 16, scale: 4 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 6 }).notNull(),
    amountUsd: numeric('amount_usd', { precision: 12, scale: 4 }).notNull(),
    model: text('model'),
    provider: text('provider'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().default(now),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [index('usage_tenant_time_idx').on(table.tenantId, table.occurredAt)],
)

export const quotaLimits = pgTable('quota_limits', {
  tenantId: uuid('tenant_id').primaryKey(),
  maxCostUsd: numeric('max_cost_usd', { precision: 12, scale: 4 }).notNull().default('5'),
  maxJobs: integer('max_jobs').notNull().default(50),
  maxConcurrency: integer('max_concurrency').notNull().default(1),
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(2147483648),
})

export const quotaUsage = pgTable(
  'quota_usage',
  {
    tenantId: uuid('tenant_id').notNull(),
    period: text('period').notNull(),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    jobCount: integer('job_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.period] })],
)

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  detail: jsonb('detail').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
})

export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [index('webhooks_tenant_idx').on(table.tenantId, table.createdAt)],
)

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    webhookId: uuid('webhook_id').notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    index('webhook_deliveries_tenant_idx').on(table.tenantId, table.createdAt),
    index('webhook_deliveries_webhook_idx').on(table.webhookId, table.createdAt),
  ],
)

export const tenantCapabilities = pgTable(
  'tenant_capabilities',
  {
    tenantId: uuid('tenant_id').notNull(),
    capabilityId: text('capability_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.capabilityId] })],
)

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [index('templates_tenant_idx').on(table.tenantId, table.createdAt)],
)

export const shares = pgTable(
  'shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [index('shares_project_idx').on(table.tenantId, table.projectId)],
)

export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().default(now),
})

export const schema = {
  tenants,
  users,
  memberships,
  sessions,
  projects,
  assets,
  assetVersions,
  assetLinks,
  capabilities,
  capabilityDrivers,
  jobs,
  jobEvents,
  jobArtifacts,
  usageLedger,
  quotaLimits,
  quotaUsage,
  auditLogs,
  webhooks,
  webhookDeliveries,
  tenantCapabilities,
  templates,
  shares,
  schemaMigrations,
}
