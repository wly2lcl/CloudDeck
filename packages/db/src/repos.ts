import { sql, type SQL } from 'drizzle-orm'
import type { CapabilityManifest, JobEvent, JobStatus } from '@clouddeck/contracts'
import { one, rows, type Database } from './client'

const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

// ---------------------------------------------------------------------------
// 账号与租户
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string
  email: string
  password_hash: string
  display_name: string | null
  locale: string
}

export interface MembershipRow {
  tenant_id: string
  user_id: string
  role: string
  name: string
  slug: string
  tier: string
}

export async function findUserByEmail(db: Database, email: string): Promise<UserRow | null> {
  return one<UserRow>(db, sql`SELECT * FROM users WHERE lower(email) = lower(${email})`)
}

export async function findUserById(db: Database, id: string): Promise<UserRow | null> {
  return one<UserRow>(db, sql`SELECT * FROM users WHERE id = ${id}`)
}

export async function createUser(
  db: Database,
  input: { email: string; passwordHash: string; displayName?: string },
): Promise<UserRow> {
  const row = await one<UserRow>(
    db,
    sql`INSERT INTO users (email, password_hash, display_name)
        VALUES (${input.email.toLowerCase()}, ${input.passwordHash}, ${input.displayName ?? null})
        RETURNING *`,
  )
  if (!row) throw new Error('创建用户失败')
  return row
}

export async function createTenant(
  db: Database,
  input: { name: string; slug: string },
): Promise<{ id: string; name: string; slug: string; tier: string }> {
  const row = await one<{ id: string; name: string; slug: string; tier: string }>(
    db,
    sql`INSERT INTO tenants (name, slug) VALUES (${input.name}, ${input.slug})
        RETURNING id, name, slug, tier`,
  )
  if (!row) throw new Error('创建租户失败')
  await db.execute(
    sql`INSERT INTO quota_limits (tenant_id) VALUES (${row.id}) ON CONFLICT DO NOTHING`,
  )
  return row
}

export async function addMembership(
  db: Database,
  tenantId: string,
  userId: string,
  role: string,
): Promise<void> {
  await db.execute(
    sql`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantId}, ${userId}, ${role})
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
  )
}

export async function listMemberships(db: Database, userId: string): Promise<MembershipRow[]> {
  return rows<MembershipRow>(
    db,
    sql`SELECT m.tenant_id, m.user_id, m.role, t.name, t.slug, t.tier
        FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = ${userId} AND m.status = 'active'
        ORDER BY m.created_at`,
  )
}

export async function findMembership(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<{ role: string } | null> {
  return one<{ role: string }>(
    db,
    sql`SELECT role FROM memberships
        WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND status = 'active'`,
  )
}

export interface SessionRow {
  id: string
  user_id: string
  tenant_id: string
  refresh_token_hash: string
  expires_at: Date
  revoked_at: Date | null
}

export async function createSession(
  db: Database,
  input: {
    userId: string
    tenantId: string
    refreshTokenHash: string
    expiresAt: Date
    device?: string
    ip?: string
  },
): Promise<SessionRow> {
  const row = await one<SessionRow>(
    db,
    sql`INSERT INTO sessions (user_id, tenant_id, refresh_token_hash, expires_at, device, ip)
        VALUES (${input.userId}, ${input.tenantId}, ${input.refreshTokenHash}, ${input.expiresAt}, ${input.device ?? null}, ${input.ip ?? null})
        RETURNING *`,
  )
  if (!row) throw new Error('创建会话失败')
  return row
}

export async function findSessionByRefreshHash(
  db: Database,
  hash: string,
): Promise<SessionRow | null> {
  return one<SessionRow>(db, sql`SELECT * FROM sessions WHERE refresh_token_hash = ${hash}`)
}

export async function rotateSession(
  db: Database,
  sessionId: string,
  refreshTokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await db.execute(
    sql`UPDATE sessions SET refresh_token_hash = ${refreshTokenHash}, expires_at = ${expiresAt}
        WHERE id = ${sessionId} AND revoked_at IS NULL`,
  )
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.execute(sql`UPDATE sessions SET revoked_at = now() WHERE id = ${sessionId}`)
}

// ---------------------------------------------------------------------------
// 项目与资产（必须带租户事务）
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string
  tenant_id: string
  name: string
  description: string | null
  status: string
  created_at: Date
  updated_at: Date
}

export interface AssetRow {
  id: string
  tenant_id: string
  project_id: string
  type: string
  name: string
  mime: string
  size_bytes: number
  checksum_sha256: string
  storage_key: string
  meta: Record<string, unknown>
  latest_version: number
  created_at: Date
}

export interface AssetVersionRow {
  tenant_id: string
  asset_id: string
  version: number
  storage_key: string
  size_bytes: number
  checksum_sha256: string
  meta: Record<string, unknown>
  created_at: Date
}

export async function createProject(
  db: Database,
  input: { tenantId: string; name: string; description?: string; createdBy?: string },
): Promise<ProjectRow> {
  const row = await one<ProjectRow>(
    db,
    sql`INSERT INTO projects (tenant_id, name, description, created_by)
        VALUES (${input.tenantId}, ${input.name}, ${input.description ?? null}, ${input.createdBy ?? null})
        RETURNING *`,
  )
  if (!row) throw new Error('创建项目失败')
  return row
}

export async function listProjects(db: Database, tenantId: string): Promise<ProjectRow[]> {
  return rows<ProjectRow>(
    db,
    sql`SELECT * FROM projects WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        ORDER BY created_at DESC`,
  )
}

export async function getProject(
  db: Database,
  tenantId: string,
  projectId: string,
): Promise<ProjectRow | null> {
  return one<ProjectRow>(
    db,
    sql`SELECT * FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId} AND deleted_at IS NULL`,
  )
}

export async function softDeleteProject(
  db: Database,
  tenantId: string,
  projectId: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`UPDATE projects SET deleted_at = now(), updated_at = now()
        WHERE id = ${projectId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        RETURNING id`,
  )
  return row !== null
}

export async function createAsset(
  db: Database,
  input: {
    id?: string
    tenantId: string
    projectId: string
    type: string
    name: string
    mime: string
    sizeBytes: number
    checksumSha256: string
    storageKey: string
    createdBy?: string
    meta?: Record<string, unknown>
  },
): Promise<AssetRow> {
  const assetId = input.id ?? crypto.randomUUID()
  const row = await one<AssetRow>(
    db,
    sql`INSERT INTO assets (id, tenant_id, project_id, type, name, mime, size_bytes, checksum_sha256, storage_key, created_by, meta)
        VALUES (${assetId}, ${input.tenantId}, ${input.projectId}, ${input.type}, ${input.name}, ${input.mime},
                ${input.sizeBytes}, ${input.checksumSha256}, ${input.storageKey}, ${input.createdBy ?? null},
                ${json(input.meta ?? {})})
        RETURNING *`,
  )
  if (!row) throw new Error('创建资产失败')
  await db.execute(
    sql`INSERT INTO asset_versions (tenant_id, asset_id, version, storage_key, size_bytes, checksum_sha256, meta)
        VALUES (${input.tenantId}, ${row.id}, 1, ${input.storageKey}, ${input.sizeBytes}, ${input.checksumSha256}, ${json(input.meta ?? {})})`,
  )
  return row
}

export async function addAssetVersion(
  db: Database,
  input: {
    tenantId: string
    assetId: string
    storageKey: string
    sizeBytes: number
    checksumSha256: string
    createdByJobId?: string
    meta?: Record<string, unknown>
  },
): Promise<{ asset: AssetRow; version: number }> {
  const asset = await one<AssetRow>(
    db,
    sql`SELECT * FROM assets WHERE id = ${input.assetId} AND tenant_id = ${input.tenantId} FOR UPDATE`,
  )
  if (!asset) throw new Error('资产不存在')
  const version = asset.latest_version + 1
  await db.execute(
    sql`INSERT INTO asset_versions (tenant_id, asset_id, version, storage_key, size_bytes, checksum_sha256, meta, created_by_job_id)
        VALUES (${input.tenantId}, ${input.assetId}, ${version}, ${input.storageKey}, ${input.sizeBytes}, ${input.checksumSha256}, ${json(input.meta ?? {})}, ${input.createdByJobId ?? null})`,
  )
  const updated = await one<AssetRow>(
    db,
    sql`UPDATE assets SET latest_version = ${version}, storage_key = ${input.storageKey},
            size_bytes = ${input.sizeBytes}, checksum_sha256 = ${input.checksumSha256},
            mime = mime
        WHERE id = ${input.assetId} AND tenant_id = ${input.tenantId}
        RETURNING *`,
  )
  if (!updated) throw new Error('更新资产失败')
  return { asset: updated, version }
}

export async function getAsset(
  db: Database,
  tenantId: string,
  assetId: string,
): Promise<AssetRow | null> {
  return one<AssetRow>(
    db,
    sql`SELECT * FROM assets WHERE id = ${assetId} AND tenant_id = ${tenantId}`,
  )
}

export async function listAssets(
  db: Database,
  tenantId: string,
  projectId: string,
): Promise<AssetRow[]> {
  return rows<AssetRow>(
    db,
    sql`SELECT * FROM assets WHERE tenant_id = ${tenantId} AND project_id = ${projectId}
        ORDER BY created_at DESC`,
  )
}

export async function listAssetVersions(
  db: Database,
  tenantId: string,
  assetId: string,
): Promise<AssetVersionRow[]> {
  return rows<AssetVersionRow>(
    db,
    sql`SELECT * FROM asset_versions WHERE tenant_id = ${tenantId} AND asset_id = ${assetId}
        ORDER BY version DESC`,
  )
}

export async function linkAssets(
  db: Database,
  input: {
    tenantId: string
    projectId: string
    fromAssetId: string
    fromVersion: number
    toAssetId: string
    toVersion: number
    relation?: string
  },
): Promise<void> {
  await db.execute(
    sql`INSERT INTO asset_links (tenant_id, project_id, from_asset_id, from_version, to_asset_id, to_version, relation)
        VALUES (${input.tenantId}, ${input.projectId}, ${input.fromAssetId}, ${input.fromVersion},
                ${input.toAssetId}, ${input.toVersion}, ${input.relation ?? 'derived_from'})`,
  )
}

// ---------------------------------------------------------------------------
// 能力注册表（全局，无租户）
// ---------------------------------------------------------------------------

export async function upsertCapability(
  db: Database,
  manifest: CapabilityManifest,
): Promise<void> {
  await db.execute(
    sql`INSERT INTO capabilities (id, version, name, category, manifest, status, driver_default, updated_at)
        VALUES (${manifest.id}, ${manifest.version}, ${manifest.name}, ${manifest.category},
                ${json(manifest)}, 'active', ${manifest.driver.ref}, now())
        ON CONFLICT (id, version) DO UPDATE SET
          name = EXCLUDED.name, category = EXCLUDED.category, manifest = EXCLUDED.manifest,
          driver_default = EXCLUDED.driver_default, updated_at = now()`,
  )
}

export interface CapabilityRow {
  id: string
  version: string
  name: string
  category: string
  manifest: CapabilityManifest
  status: string
  driver_default: string
}

export async function listCapabilities(db: Database): Promise<CapabilityRow[]> {
  return rows<CapabilityRow>(
    db,
    sql`SELECT * FROM capabilities WHERE status = 'active' ORDER BY category, id`,
  )
}

export async function getCapability(
  db: Database,
  id: string,
  version?: string,
): Promise<CapabilityRow | null> {
  if (version) {
    return one<CapabilityRow>(
      db,
      sql`SELECT * FROM capabilities WHERE id = ${id} AND version = ${version} AND status = 'active'`,
    )
  }
  return one<CapabilityRow>(
    db,
    sql`SELECT * FROM capabilities WHERE id = ${id} AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
  )
}

// ---------------------------------------------------------------------------
// 任务、事件与计量
// ---------------------------------------------------------------------------

export interface JobRow {
  id: string
  tenant_id: string
  project_id: string
  capability_id: string
  capability_version: string
  status: JobStatus
  driver_id: string
  params: Record<string, unknown>
  input_assets: { assetId: string; version: number }[]
  output_assets: { assetId: string; version: number; name: string; type: string }[]
  estimated_cost_usd: string
  actual_cost_usd: string
  error_code: string | null
  error_message: string | null
  cancel_requested: boolean
  attempts: number
  retried_from_job_id: string | null
  created_by: string | null
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
}

export async function createJob(
  db: Database,
  input: {
    tenantId: string
    projectId: string
    capabilityId: string
    capabilityVersion: string
    driverId: string
    params: Record<string, unknown>
    inputAssets: { assetId: string; version: number }[]
    estimatedCostUsd: number
    createdBy?: string
  },
): Promise<JobRow> {
  const row = await one<JobRow>(
    db,
    sql`INSERT INTO jobs (tenant_id, project_id, capability_id, capability_version, driver_id,
                         params, input_assets, estimated_cost_usd, created_by)
        VALUES (${input.tenantId}, ${input.projectId}, ${input.capabilityId}, ${input.capabilityVersion},
                ${input.driverId}, ${json(input.params)}, ${json(input.inputAssets)},
                ${input.estimatedCostUsd}, ${input.createdBy ?? null})
        RETURNING *`,
  )
  if (!row) throw new Error('创建任务失败')
  return row
}

export async function getJob(
  db: Database,
  tenantId: string,
  jobId: string,
): Promise<JobRow | null> {
  return one<JobRow>(
    db,
    sql`SELECT * FROM jobs WHERE id = ${jobId} AND tenant_id = ${tenantId}`,
  )
}

export async function listJobs(
  db: Database,
  tenantId: string,
  projectId?: string,
): Promise<JobRow[]> {
  if (projectId) {
    return rows<JobRow>(
      db,
      sql`SELECT * FROM jobs WHERE tenant_id = ${tenantId} AND project_id = ${projectId}
          ORDER BY created_at DESC LIMIT 100`,
    )
  }
  return rows<JobRow>(
    db,
    sql`SELECT * FROM jobs WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 100`,
  )
}

export async function requestCancel(
  db: Database,
  tenantId: string,
  jobId: string,
): Promise<JobRow | null> {
  return one<JobRow>(
    db,
    sql`UPDATE jobs SET cancel_requested = true, updated_at = now()
        WHERE id = ${jobId} AND tenant_id = ${tenantId}
          AND status IN ('queued', 'provisioning', 'running', 'finalizing')
        RETURNING *`,
  )
}

export async function appendJobEvent(
  db: Database,
  tenantId: string,
  jobId: string,
  event: JobEvent,
): Promise<number> {
  const row = await one<{ seq: number }>(
    db,
    sql`INSERT INTO job_events (tenant_id, job_id, type, payload, at)
        VALUES (${tenantId}, ${jobId}, ${event.type}, ${json(event)}, ${event.at})
        RETURNING seq`,
  )
  return row?.seq ?? 0
}

export interface StoredJobEvent {
  seq: number
  type: string
  payload: JobEvent
  at: Date
}

export async function listJobEvents(
  db: Database,
  jobId: string,
  afterSeq: number,
  limit = 200,
): Promise<StoredJobEvent[]> {
  return rows<StoredJobEvent>(
    db,
    sql`SELECT seq, type, payload, at FROM job_events
        WHERE job_id = ${jobId} AND seq > ${afterSeq}
        ORDER BY seq LIMIT ${limit}`,
  )
}

export async function setJobStatus(
  db: Database,
  jobId: string,
  status: JobStatus,
  extra?: { errorCode?: string; errorMessage?: string },
): Promise<void> {
  await db.execute(
    sql`UPDATE jobs SET status = ${status}, updated_at = now(),
          error_code = ${extra?.errorCode ?? null}, error_message = ${extra?.errorMessage ?? null},
          finished_at = CASE WHEN ${status} IN ('succeeded','failed','cancelled') THEN now() ELSE finished_at END
        WHERE id = ${jobId}`,
  )
}

export async function claimNextJob(db: Database): Promise<JobRow | null> {
  return one<JobRow>(
    db,
    sql`UPDATE jobs SET status = 'provisioning', attempts = attempts + 1,
            started_at = COALESCE(started_at, now()),
            lease_until = now() + interval '5 minutes', updated_at = now()
        WHERE id = (
          SELECT id FROM jobs WHERE status = 'queued'
          ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING *`,
  )
}

export async function resumeJob(
  db: Database,
  tenantId: string,
  jobId: string,
): Promise<JobRow | null> {
  return one<JobRow>(
    db,
    sql`UPDATE jobs
        SET status = 'queued', resume_count = resume_count + 1,
            error_code = NULL, error_message = NULL, cancel_requested = false,
            finished_at = NULL, lease_until = NULL, updated_at = now()
        WHERE id = ${jobId} AND tenant_id = ${tenantId}
          AND status IN ('failed', 'cancelled')
        RETURNING *`,
  )
}

export async function retryJob(
  db: Database,
  tenantId: string,
  jobId: string,
): Promise<JobRow | null> {
  const job = await one<JobRow>(
    db,
    sql`SELECT * FROM jobs WHERE id = ${jobId} AND tenant_id = ${tenantId}`,
  )
  if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return null

  return one<JobRow>(
    db,
    sql`INSERT INTO jobs (tenant_id, project_id, capability_id, capability_version, driver_id,
                         params, input_assets, estimated_cost_usd, created_by, retried_from_job_id)
        VALUES (${tenantId}, ${job.project_id}, ${job.capability_id}, ${job.capability_version},
                ${job.driver_id}, ${json(job.params)}, ${json(job.input_assets)},
                ${job.estimated_cost_usd}, ${job.created_by}, ${job.id})
        RETURNING *`,
  )
}

export async function isCancelRequested(db: Database, jobId: string): Promise<boolean> {
  const row = await one<{ cancel_requested: boolean }>(
    db,
    sql`SELECT cancel_requested FROM jobs WHERE id = ${jobId}`,
  )
  return row?.cancel_requested ?? false
}

export async function sumJobUsage(db: Database, jobId: string): Promise<number> {
  const row = await one<{ total: string | null }>(
    db,
    sql`SELECT COALESCE(SUM(amount_usd), 0)::text AS total FROM usage_ledger WHERE job_id = ${jobId}`,
  )
  return Number(row?.total ?? 0)
}

export async function insertUsage(
  db: Database,
  input: {
    tenantId: string
    jobId: string
    capabilityId: string
    driverId: string
    unit: string
    quantity: number
    unitPrice: number
    amountUsd: number
    period: string
  },
): Promise<void> {
  await db.execute(
    sql`INSERT INTO usage_ledger (tenant_id, job_id, capability_id, driver_id, unit, quantity, unit_price, amount_usd)
        VALUES (${input.tenantId}, ${input.jobId}, ${input.capabilityId}, ${input.driverId},
                ${input.unit}, ${input.quantity}, ${input.unitPrice}, ${input.amountUsd})`,
  )
  await db.execute(
    sql`INSERT INTO quota_usage (tenant_id, period, cost_usd, job_count)
        VALUES (${input.tenantId}, ${input.period}, ${input.amountUsd}, 0)
        ON CONFLICT (tenant_id, period) DO UPDATE
        SET cost_usd = quota_usage.cost_usd + EXCLUDED.cost_usd, updated_at = now()`,
  )
}

export async function incrementQuotaJobs(
  db: Database,
  tenantId: string,
  period: string,
): Promise<void> {
  await db.execute(
    sql`INSERT INTO quota_usage (tenant_id, period, job_count)
        VALUES (${tenantId}, ${period}, 1)
        ON CONFLICT (tenant_id, period) DO UPDATE
        SET job_count = quota_usage.job_count + 1, updated_at = now()`,
  )
}

export interface QuotaSnapshot {
  max_cost_usd: string
  max_jobs: number
  max_concurrency: number
  cost_usd: string
  job_count: number
  running: number
}

export async function getQuotaSnapshot(
  db: Database,
  tenantId: string,
  period: string,
): Promise<QuotaSnapshot | null> {
  return one<QuotaSnapshot>(
    db,
    sql`SELECT l.max_cost_usd, l.max_jobs, l.max_concurrency,
               COALESCE(u.cost_usd, 0)::text AS cost_usd, COALESCE(u.job_count, 0) AS job_count,
               (SELECT COUNT(*)::int FROM jobs j
                WHERE j.tenant_id = ${tenantId} AND j.status IN ('provisioning','running','finalizing')) AS running
        FROM quota_limits l
        LEFT JOIN quota_usage u ON u.tenant_id = l.tenant_id AND u.period = ${period}
        WHERE l.tenant_id = ${tenantId}`,
  )
}

export async function getUsageSummary(
  db: Database,
  tenantId: string,
  period: string,
): Promise<{ cost_usd: string; job_count: number }> {
  const row = await one<{ cost_usd: string; job_count: number }>(
    db,
    sql`SELECT COALESCE(cost_usd, 0)::text AS cost_usd, COALESCE(job_count, 0) AS job_count
        FROM quota_usage WHERE tenant_id = ${tenantId} AND period = ${period}`,
  )
  return row ?? { cost_usd: '0', job_count: 0 }
}

export interface AssetVersionDetail {
  storage_key: string
  size_bytes: number
  checksum_sha256: string
  name: string
  mime: string
  type: string
}

export async function getAssetVersionDetail(
  db: Database,
  tenantId: string,
  assetId: string,
  version: number,
): Promise<AssetVersionDetail | null> {
  return one<AssetVersionDetail>(
    db,
    sql`SELECT av.storage_key, av.size_bytes, av.checksum_sha256, a.name, a.mime, a.type
        FROM asset_versions av JOIN assets a ON a.id = av.asset_id
        WHERE av.tenant_id = ${tenantId} AND av.asset_id = ${assetId} AND av.version = ${version}`,
  )
}

export async function insertJobArtifact(
  db: Database,
  input: {
    tenantId: string
    jobId: string
    assetId: string
    version: number
    name: string
    type: string
    mime: string
    sizeBytes: number
  },
): Promise<void> {
  await db.execute(
    sql`INSERT INTO job_artifacts (tenant_id, job_id, asset_id, version, name, type, mime, size_bytes)
        VALUES (${input.tenantId}, ${input.jobId}, ${input.assetId}, ${input.version},
                ${input.name}, ${input.type}, ${input.mime}, ${input.sizeBytes})`,
  )
}

export async function setJobOutputs(
  db: Database,
  jobId: string,
  outputs: { assetId: string; version: number; name: string; type: string }[],
  actualCostUsd: number,
): Promise<void> {
  await db.execute(
    sql`UPDATE jobs SET output_assets = ${json(outputs)}, actual_cost_usd = ${actualCostUsd}, updated_at = now()
        WHERE id = ${jobId}`,
  )
}

export interface AssetLinkRow {
  from_asset_id: string
  from_version: number
  to_asset_id: string
  to_version: number
  relation: string
}

export async function listAssetLinks(
  db: Database,
  tenantId: string,
  projectId: string,
): Promise<AssetLinkRow[]> {
  return rows<AssetLinkRow>(
    db,
    sql`SELECT from_asset_id, from_version, to_asset_id, to_version, relation
        FROM asset_links WHERE tenant_id = ${tenantId} AND project_id = ${projectId}`,
  )
}

export async function listProjectGraph(
  db: Database,
  tenantId: string,
  projectId: string,
): Promise<{ assets: AssetRow[]; links: AssetLinkRow[] }> {
  const [assets, links] = await Promise.all([
    listAssets(db, tenantId, projectId),
    listAssetLinks(db, tenantId, projectId),
  ])
  return { assets, links }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export interface WebhookRow {
  id: string
  tenant_id: string
  url: string
  secret: string
  events: string[]
  enabled: boolean
  created_at: Date
}

export interface WebhookDeliveryRow {
  id: string
  tenant_id: string
  webhook_id: string
  event: string
  payload: Record<string, unknown>
  status: string
  attempts: number
  last_error: string | null
  created_at: Date
  delivered_at: Date | null
}

export async function createWebhook(
  db: Database,
  input: { tenantId: string; url: string; secret: string; events: string[] },
): Promise<WebhookRow> {
  const row = await one<WebhookRow>(
    db,
    sql`INSERT INTO webhooks (tenant_id, url, secret, events)
        VALUES (${input.tenantId}, ${input.url}, ${input.secret}, ${json(input.events)})
        RETURNING *`,
  )
  if (!row) throw new Error('创建 webhook 失败')
  return row
}

export async function listWebhooks(db: Database, tenantId: string): Promise<WebhookRow[]> {
  return rows<WebhookRow>(
    db,
    sql`SELECT * FROM webhooks WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`,
  )
}

export async function deleteWebhook(
  db: Database,
  tenantId: string,
  webhookId: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`DELETE FROM webhooks WHERE id = ${webhookId} AND tenant_id = ${tenantId} RETURNING id`,
  )
  return row !== null
}

export async function listEnabledWebhooks(
  db: Database,
  tenantId: string,
  event: string,
): Promise<WebhookRow[]> {
  return rows<WebhookRow>(
    db,
    sql`SELECT * FROM webhooks
        WHERE tenant_id = ${tenantId} AND enabled = true
          AND (events = '[]'::jsonb OR events @> ${json([event])}::jsonb)`,
  )
}

export async function createWebhookDelivery(
  db: Database,
  input: { tenantId: string; webhookId: string; event: string; payload: Record<string, unknown> },
): Promise<WebhookDeliveryRow> {
  const row = await one<WebhookDeliveryRow>(
    db,
    sql`INSERT INTO webhook_deliveries (tenant_id, webhook_id, event, payload)
        VALUES (${input.tenantId}, ${input.webhookId}, ${input.event}, ${json(input.payload)})
        RETURNING *`,
  )
  if (!row) throw new Error('创建 webhook 投递失败')
  return row
}

export async function finishWebhookDelivery(
  db: Database,
  input: { deliveryId: string; status: string; attempts: number; lastError?: string | null },
): Promise<void> {
  await db.execute(
    sql`UPDATE webhook_deliveries
        SET status = ${input.status}, attempts = ${input.attempts},
            last_error = ${input.lastError ?? null},
            delivered_at = CASE WHEN ${input.status} = 'delivered' THEN now() ELSE delivered_at END
        WHERE id = ${input.deliveryId}`,
  )
}

export async function listWebhookDeliveries(
  db: Database,
  tenantId: string,
): Promise<WebhookDeliveryRow[]> {
  return rows<WebhookDeliveryRow>(
    db,
    sql`SELECT * FROM webhook_deliveries WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC LIMIT 100`,
  )
}

export function periodOf(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export type { SQL }
