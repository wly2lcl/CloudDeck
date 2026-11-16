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
  email_verified_at: Date | null
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

export async function revokeUserSessions(db: Database, userId: string): Promise<void> {
  await db.execute(
    sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`,
  )
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
  reserved_cost_usd: string
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
               COALESCE(u.cost_usd, 0)::text AS cost_usd,
               COALESCE(u.reserved_cost_usd, 0)::text AS reserved_cost_usd,
               COALESCE(u.job_count, 0) AS job_count,
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

// ---------------------------------------------------------------------------
// M5：套餐、能力开关、模板、分享、用量明细
// ---------------------------------------------------------------------------

export type TenantTier = 'free' | 'pro' | 'team'

export const PLAN_LIMITS: Record<
  TenantTier,
  { maxCostUsd: number; maxJobs: number; maxConcurrency: number; storageBytes: number }
> = {
  free: { maxCostUsd: 5, maxJobs: 50, maxConcurrency: 1, storageBytes: 2 * 1024 * 1024 * 1024 },
  pro: { maxCostUsd: 100, maxJobs: 1000, maxConcurrency: 4, storageBytes: 50 * 1024 * 1024 * 1024 },
  team: { maxCostUsd: 1000, maxJobs: 10000, maxConcurrency: 16, storageBytes: 500 * 1024 * 1024 * 1024 },
}

export interface TenantRow {
  id: string
  name: string
  slug: string
  tier: TenantTier
  status: string
  created_at: Date
}

export async function getTenant(db: Database, tenantId: string): Promise<TenantRow | null> {
  return one<TenantRow>(db, sql`SELECT * FROM tenants WHERE id = ${tenantId}`)
}

export async function updateTenantPlan(
  db: Database,
  tenantId: string,
  tier: TenantTier,
): Promise<TenantRow | null> {
  const limits = PLAN_LIMITS[tier]
  const tenant = await one<TenantRow>(
    db,
    sql`UPDATE tenants SET tier = ${tier} WHERE id = ${tenantId} RETURNING *`,
  )
  if (!tenant) return null
  await db.execute(
    sql`INSERT INTO quota_limits (tenant_id, max_cost_usd, max_jobs, max_concurrency, storage_bytes)
        VALUES (${tenantId}, ${limits.maxCostUsd}, ${limits.maxJobs}, ${limits.maxConcurrency}, ${limits.storageBytes})
        ON CONFLICT (tenant_id) DO UPDATE SET
          max_cost_usd = EXCLUDED.max_cost_usd,
          max_jobs = EXCLUDED.max_jobs,
          max_concurrency = EXCLUDED.max_concurrency,
          storage_bytes = EXCLUDED.storage_bytes`,
  )
  return tenant
}

export async function listTenantCapabilityStates(
  db: Database,
  tenantId: string,
): Promise<{ capability_id: string; enabled: boolean }[]> {
  return rows<{ capability_id: string; enabled: boolean }>(
    db,
    sql`SELECT capability_id, enabled FROM tenant_capabilities WHERE tenant_id = ${tenantId}`,
  )
}

export async function setTenantCapability(
  db: Database,
  tenantId: string,
  capabilityId: string,
  enabled: boolean,
): Promise<void> {
  await db.execute(
    sql`INSERT INTO tenant_capabilities (tenant_id, capability_id, enabled, updated_at)
        VALUES (${tenantId}, ${capabilityId}, ${enabled}, now())
        ON CONFLICT (tenant_id, capability_id) DO UPDATE
        SET enabled = EXCLUDED.enabled, updated_at = now()`,
  )
}

export async function isCapabilityEnabled(
  db: Database,
  tenantId: string,
  capabilityId: string,
): Promise<boolean> {
  const row = await one<{ enabled: boolean }>(
    db,
    sql`SELECT enabled FROM tenant_capabilities
        WHERE tenant_id = ${tenantId} AND capability_id = ${capabilityId}`,
  )
  return row?.enabled ?? true
}

export async function listCapabilitiesForTenant(
  db: Database,
  tenantId: string,
): Promise<CapabilityRow[]> {
  return rows<CapabilityRow>(
    db,
    sql`SELECT c.* FROM capabilities c
        LEFT JOIN tenant_capabilities tc
          ON tc.capability_id = c.id AND tc.tenant_id = ${tenantId}
        WHERE c.status = 'active' AND COALESCE(tc.enabled, true) = true
        ORDER BY c.category, c.id`,
  )
}

export interface TemplateRow {
  id: string
  tenant_id: string
  name: string
  description: string | null
  payload: Record<string, unknown>
  is_public: boolean
  created_at: Date
}

export interface PublicTemplateRow {
  id: string
  name: string
  description: string | null
  payload: Record<string, unknown>
  created_at: Date
}

export async function createTemplate(
  db: Database,
  input: {
    tenantId: string
    name: string
    description?: string
    payload?: Record<string, unknown>
  },
): Promise<TemplateRow> {
  const row = await one<TemplateRow>(
    db,
    sql`INSERT INTO templates (tenant_id, name, description, payload)
        VALUES (${input.tenantId}, ${input.name}, ${input.description ?? null}, ${json(input.payload ?? {})})
        RETURNING *`,
  )
  if (!row) throw new Error('创建模板失败')
  return row
}

export async function listTemplates(db: Database, tenantId: string): Promise<TemplateRow[]> {
  return rows<TemplateRow>(
    db,
    sql`SELECT * FROM templates WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`,
  )
}

export async function getTemplate(
  db: Database,
  tenantId: string,
  templateId: string,
): Promise<TemplateRow | null> {
  return one<TemplateRow>(
    db,
    sql`SELECT * FROM templates WHERE id = ${templateId} AND tenant_id = ${tenantId}`,
  )
}

export async function setTemplatePublic(
  db: Database,
  tenantId: string,
  templateId: string,
  isPublic: boolean,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`UPDATE templates SET is_public = ${isPublic}
        WHERE id = ${templateId} AND tenant_id = ${tenantId}
        RETURNING id`,
  )
  return row !== null
}

export async function listPublicTemplates(db: Database): Promise<PublicTemplateRow[]> {
  return rows<PublicTemplateRow>(db, sql`SELECT * FROM list_public_templates()`)
}

export async function getPublicTemplate(
  db: Database,
  templateId: string,
): Promise<PublicTemplateRow | null> {
  return one<PublicTemplateRow>(db, sql`SELECT * FROM get_public_template(${templateId})`)
}

export async function importPublicTemplate(
  db: Database,
  tenantId: string,
  templateId: string,
): Promise<TemplateRow | null> {
  const template = await getPublicTemplate(db, templateId)
  if (!template) return null
  return createTemplate(db, {
    tenantId,
    name: template.name,
    description: template.description ?? undefined,
    payload: template.payload,
  })
}

export async function deleteTemplate(
  db: Database,
  tenantId: string,
  templateId: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`DELETE FROM templates WHERE id = ${templateId} AND tenant_id = ${tenantId} RETURNING id`,
  )
  return row !== null
}

export interface ShareRow {
  id: string
  tenant_id: string
  project_id: string
  token_hash: string
  expires_at: Date | null
  revoked_at: Date | null
  created_at: Date
}

export async function createShare(
  db: Database,
  input: {
    tenantId: string
    projectId: string
    tokenHash: string
    expiresAt?: Date | null
  },
): Promise<ShareRow> {
  const row = await one<ShareRow>(
    db,
    sql`INSERT INTO shares (tenant_id, project_id, token_hash, expires_at)
        VALUES (${input.tenantId}, ${input.projectId}, ${input.tokenHash}, ${input.expiresAt ?? null})
        RETURNING *`,
  )
  if (!row) throw new Error('创建分享失败')
  return row
}

export async function listShares(
  db: Database,
  tenantId: string,
  projectId: string,
): Promise<ShareRow[]> {
  return rows<ShareRow>(
    db,
    sql`SELECT * FROM shares
        WHERE tenant_id = ${tenantId} AND project_id = ${projectId}
        ORDER BY created_at DESC`,
  )
}

export async function revokeShare(
  db: Database,
  tenantId: string,
  shareId: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`UPDATE shares SET revoked_at = now()
        WHERE id = ${shareId} AND tenant_id = ${tenantId} AND revoked_at IS NULL
        RETURNING id`,
  )
  return row !== null
}

export interface PublicShareRow {
  id: string
  tenant_id: string
  project_id: string
  expires_at: Date | null
  revoked_at: Date | null
}

/** 通过 SECURITY DEFINER 函数查找分享，调用方随后必须进入对应租户上下文。 */
export async function findShareByTokenHash(
  db: Database,
  tokenHash: string,
): Promise<PublicShareRow | null> {
  return one<PublicShareRow>(
    db,
    sql`SELECT * FROM find_share_by_token(${tokenHash})`,
  )
}

export interface UsageBreakdownRow {
  capability_id: string
  driver_id: string
  unit: string
  quantity: string
  amount_usd: string
  entries: number
}

export function periodRange(period: string): { start: Date; end: Date } {
  const [yearValue, monthValue] = period.split('-')
  const year = Number(yearValue)
  const month = Number(monthValue)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`账期格式非法: ${period}`)
  }
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  }
}

export async function usageBreakdown(
  db: Database,
  tenantId: string,
  period: string,
): Promise<UsageBreakdownRow[]> {
  const { start, end } = periodRange(period)

  return rows<UsageBreakdownRow>(
    db,
    sql`SELECT capability_id, driver_id, unit,
               SUM(quantity)::text AS quantity,
               SUM(amount_usd)::text AS amount_usd,
               COUNT(*)::int AS entries
        FROM usage_ledger
        WHERE tenant_id = ${tenantId}
          AND occurred_at >= ${start.toISOString()}::timestamptz
          AND occurred_at < ${end.toISOString()}::timestamptz
        GROUP BY capability_id, driver_id, unit
        ORDER BY SUM(amount_usd) DESC`,
  )
}

export interface CommentRow {
  id: string
  tenant_id: string
  project_id: string
  asset_id: string | null
  user_id: string
  body: string
  created_at: Date
  author_name: string | null
  author_email: string
}

export async function createComment(
  db: Database,
  input: { tenantId: string; projectId: string; userId: string; body: string; assetId?: string },
): Promise<CommentRow> {
  const row = await one<CommentRow>(
    db,
    sql`WITH inserted AS (
          INSERT INTO comments (tenant_id, project_id, asset_id, user_id, body)
          VALUES (${input.tenantId}, ${input.projectId}, ${input.assetId ?? null}, ${input.userId}, ${input.body})
          RETURNING *
        )
        SELECT inserted.*, u.display_name AS author_name, u.email AS author_email
        FROM inserted JOIN users u ON u.id = inserted.user_id`,
  )
  if (!row) throw new Error('创建评论失败')
  return row
}

export async function listComments(
  db: Database,
  tenantId: string,
  projectId: string,
): Promise<CommentRow[]> {
  return rows<CommentRow>(
    db,
    sql`SELECT c.*, u.display_name AS author_name, u.email AS author_email
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.tenant_id = ${tenantId} AND c.project_id = ${projectId}
        ORDER BY c.created_at ASC`,
  )
}

export async function listCommentsAfter(
  db: Database,
  tenantId: string,
  projectId: string,
  after: Date,
): Promise<CommentRow[]> {
  return rows<CommentRow>(
    db,
    sql`SELECT c.*, u.display_name AS author_name, u.email AS author_email
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.tenant_id = ${tenantId} AND c.project_id = ${projectId}
          AND c.created_at > ${after.toISOString()}::timestamptz
        ORDER BY c.created_at ASC LIMIT 100`,
  )
}

export async function getComment(
  db: Database,
  tenantId: string,
  commentId: string,
): Promise<{ id: string; user_id: string } | null> {
  return one<{ id: string; user_id: string }>(
    db,
    sql`SELECT id, user_id FROM comments WHERE id = ${commentId} AND tenant_id = ${tenantId}`,
  )
}

export async function deleteComment(
  db: Database,
  tenantId: string,
  commentId: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`DELETE FROM comments WHERE id = ${commentId} AND tenant_id = ${tenantId} RETURNING id`,
  )
  return row !== null
}

export interface ModelCredentialRow {
  id: string
  tenant_id: string
  provider: string
  label: string
  encrypted_secret: string
  key_hint: string
  status: string
  created_at: Date
  last_used_at: Date | null
}

export async function createModelCredential(
  db: Database,
  input: {
    tenantId: string
    provider: string
    label: string
    encryptedSecret: string
    keyHint: string
  },
): Promise<ModelCredentialRow> {
  const row = await one<ModelCredentialRow>(
    db,
    sql`INSERT INTO model_credentials (tenant_id, provider, label, encrypted_secret, key_hint)
        VALUES (${input.tenantId}, ${input.provider}, ${input.label}, ${input.encryptedSecret}, ${input.keyHint})
        RETURNING *`,
  )
  if (!row) throw new Error('创建凭据失败')
  return row
}

export async function listModelCredentials(
  db: Database,
  tenantId: string,
): Promise<ModelCredentialRow[]> {
  return rows<ModelCredentialRow>(
    db,
    sql`SELECT * FROM model_credentials
        WHERE tenant_id = ${tenantId} AND status = 'active'
        ORDER BY created_at DESC`,
  )
}

export async function touchModelCredential(db: Database, credentialId: string): Promise<void> {
  await db.execute(
    sql`UPDATE model_credentials SET last_used_at = now() WHERE id = ${credentialId}`,
  )
}

export async function updateModelCredentialSecret(
  db: Database,
  tenantId: string,
  credentialId: string,
  encryptedSecret: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`UPDATE model_credentials SET encrypted_secret = ${encryptedSecret}
        WHERE id = ${credentialId} AND tenant_id = ${tenantId}
        RETURNING id`,
  )
  return row !== null
}

export async function deleteModelCredential(
  db: Database,
  tenantId: string,
  credentialId: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`DELETE FROM model_credentials
        WHERE id = ${credentialId} AND tenant_id = ${tenantId}
        RETURNING id`,
  )
  return row !== null
}

export interface JobReconciliationRow {
  job_id: string
  capability_id: string
  status: string
  estimated_cost_usd: string
  actual_cost_usd: string
  usage_usd: string
}

export async function billingReconciliation(
  db: Database,
  tenantId: string,
  period: string,
): Promise<JobReconciliationRow[]> {
  const { start, end } = periodRange(period)
  return rows<JobReconciliationRow>(
    db,
    sql`SELECT j.id AS job_id, j.capability_id, j.status,
               j.estimated_cost_usd::text AS estimated_cost_usd,
               j.actual_cost_usd::text AS actual_cost_usd,
               COALESCE((SELECT SUM(u.amount_usd) FROM usage_ledger u WHERE u.job_id = j.id), 0)::text AS usage_usd
        FROM jobs j
        WHERE j.tenant_id = ${tenantId}
          AND j.created_at >= ${start.toISOString()}::timestamptz
          AND j.created_at < ${end.toISOString()}::timestamptz
        ORDER BY j.created_at DESC`,
  )
}

export interface InvoiceRow {
  id: string
  tenant_id: string
  period: string
  total_usd: string
  job_count: number
  snapshot: Record<string, unknown>
  status: string
  created_at: Date
}

export async function createInvoice(
  db: Database,
  input: {
    tenantId: string
    period: string
    totalUsd: number
    jobCount: number
    snapshot: Record<string, unknown>
  },
): Promise<{ invoice: InvoiceRow; created: boolean }> {
  const inserted = await one<InvoiceRow>(
    db,
    sql`INSERT INTO invoices (tenant_id, period, total_usd, job_count, snapshot)
        VALUES (${input.tenantId}, ${input.period}, ${input.totalUsd}, ${input.jobCount}, ${json(input.snapshot)})
        ON CONFLICT (tenant_id, period) DO NOTHING
        RETURNING *`,
  )
  if (inserted) return { invoice: inserted, created: true }

  const existing = await one<InvoiceRow>(
    db,
    sql`SELECT * FROM invoices WHERE tenant_id = ${input.tenantId} AND period = ${input.period}`,
  )
  if (!existing) throw new Error('创建账单失败')
  return { invoice: existing, created: false }
}

export async function listInvoices(db: Database, tenantId: string): Promise<InvoiceRow[]> {
  return rows<InvoiceRow>(
    db,
    sql`SELECT * FROM invoices WHERE tenant_id = ${tenantId} ORDER BY period DESC`,
  )
}

export async function getInvoice(
  db: Database,
  tenantId: string,
  invoiceId: string,
): Promise<InvoiceRow | null> {
  return one<InvoiceRow>(
    db,
    sql`SELECT * FROM invoices WHERE id = ${invoiceId} AND tenant_id = ${tenantId}`,
  )
}

export async function globalJobStatusCounts(
  db: Database,
): Promise<{ status: string; count: number }[]> {
  return rows<{ status: string; count: number }>(
    db,
    sql`SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status`,
  )
}

export async function globalUsageTotal(db: Database): Promise<number> {
  const row = await one<{ total: string }>(
    db,
    sql`SELECT COALESCE(SUM(amount_usd), 0)::text AS total FROM usage_ledger`,
  )
  return Number(row?.total ?? 0)
}

export interface PaymentRow {
  id: string
  tenant_id: string
  provider: string
  external_id: string
  tier: string
  amount_usd: string
  status: string
  created_at: Date
  updated_at: Date
}

export async function createPayment(
  db: Database,
  input: {
    tenantId: string
    provider: string
    externalId: string
    tier: string
    amountUsd: number
  },
): Promise<PaymentRow> {
  const row = await one<PaymentRow>(
    db,
    sql`INSERT INTO payments (tenant_id, provider, external_id, tier, amount_usd)
        VALUES (${input.tenantId}, ${input.provider}, ${input.externalId}, ${input.tier}, ${input.amountUsd})
        RETURNING *`,
  )
  if (!row) throw new Error('创建支付单失败')
  return row
}

export interface PublicPaymentRow {
  id: string
  tenant_id: string
  tier: string
  status: string
}

export async function getPaymentByExternalId(
  db: Database,
  provider: string,
  externalId: string,
): Promise<PublicPaymentRow | null> {
  return one<PublicPaymentRow>(
    db,
    sql`SELECT * FROM find_payment_by_external(${provider}, ${externalId})`,
  )
}

export async function listPayments(db: Database, tenantId: string): Promise<PaymentRow[]> {
  return rows<PaymentRow>(
    db,
    sql`SELECT * FROM payments WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 100`,
  )
}

export async function updatePaymentStatus(
  db: Database,
  paymentId: string,
  status: string,
): Promise<void> {
  await db.execute(
    sql`UPDATE payments SET status = ${status}, updated_at = now() WHERE id = ${paymentId}`,
  )
}

export interface DeviceTokenRow {
  id: string
  tenant_id: string
  user_id: string
  platform: string
  token: string
  created_at: Date
  last_seen_at: Date
}

export async function upsertDeviceToken(
  db: Database,
  input: { tenantId: string; userId: string; platform: string; token: string },
): Promise<DeviceTokenRow> {
  const row = await one<DeviceTokenRow>(
    db,
    sql`INSERT INTO device_tokens (tenant_id, user_id, platform, token)
        VALUES (${input.tenantId}, ${input.userId}, ${input.platform}, ${input.token})
        ON CONFLICT (token) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id, user_id = EXCLUDED.user_id,
          platform = EXCLUDED.platform, last_seen_at = now()
        RETURNING *`,
  )
  if (!row) throw new Error('注册设备失败')
  return row
}

export async function deleteDeviceToken(
  db: Database,
  tenantId: string,
  token: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`DELETE FROM device_tokens WHERE tenant_id = ${tenantId} AND token = ${token} RETURNING id`,
  )
  return row !== null
}

export async function listDeviceTokens(
  db: Database,
  tenantId: string,
): Promise<DeviceTokenRow[]> {
  return rows<DeviceTokenRow>(
    db,
    sql`SELECT * FROM device_tokens WHERE tenant_id = ${tenantId} ORDER BY last_seen_at DESC`,
  )
}

// ---------------------------------------------------------------------------
// 第一阶段收口：成员、密码、API Key、审计、额度预留
// ---------------------------------------------------------------------------

export interface MemberRow {
  tenant_id: string
  user_id: string
  role: string
  status: string
  email: string
  display_name: string | null
  created_at: Date
}

export async function listTenantMembers(
  db: Database,
  tenantId: string,
): Promise<MemberRow[]> {
  return rows<MemberRow>(
    db,
    sql`SELECT m.tenant_id, m.user_id, m.role, m.status, u.email, u.display_name, m.created_at
        FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ${tenantId}
        ORDER BY m.created_at`,
  )
}

export async function updateMemberRole(
  db: Database,
  tenantId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  const row = await one<{ user_id: string }>(
    db,
    sql`UPDATE memberships SET role = ${role}
        WHERE tenant_id = ${tenantId} AND user_id = ${userId}
        RETURNING user_id`,
  )
  return row !== null
}

export async function removeMember(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const row = await one<{ user_id: string }>(
    db,
    sql`DELETE FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${userId}
        RETURNING user_id`,
  )
  return row !== null
}

export async function countOwners(db: Database, tenantId: string): Promise<number> {
  const row = await one<{ count: number }>(
    db,
    sql`SELECT COUNT(*)::int AS count FROM memberships
        WHERE tenant_id = ${tenantId} AND role = 'owner' AND status = 'active'`,
  )
  return row?.count ?? 0
}

export async function updateUserPassword(
  db: Database,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db.execute(
    sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}`,
  )
}

export async function markEmailVerified(db: Database, userId: string): Promise<void> {
  await db.execute(
    sql`UPDATE users SET email_verified_at = now() WHERE id = ${userId}`,
  )
}

export async function createPasswordReset(
  db: Database,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await db.execute(
    sql`INSERT INTO password_resets (user_id, token_hash, expires_at)
        VALUES (${input.userId}, ${input.tokenHash}, ${input.expiresAt})`,
  )
}

export async function findPasswordResetByHash(
  db: Database,
  tokenHash: string,
): Promise<{ id: string; user_id: string; expires_at: Date; used_at: Date | null } | null> {
  return one<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
    db,
    sql`SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ${tokenHash}`,
  )
}

export async function markPasswordResetUsed(db: Database, id: string): Promise<void> {
  await db.execute(sql`UPDATE password_resets SET used_at = now() WHERE id = ${id}`)
}

export async function createEmailVerification(
  db: Database,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await db.execute(
    sql`INSERT INTO email_verifications (user_id, token_hash, expires_at)
        VALUES (${input.userId}, ${input.tokenHash}, ${input.expiresAt})`,
  )
}

export async function findEmailVerificationByHash(
  db: Database,
  tokenHash: string,
): Promise<{ id: string; user_id: string; expires_at: Date; used_at: Date | null } | null> {
  return one<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
    db,
    sql`SELECT id, user_id, expires_at, used_at FROM email_verifications WHERE token_hash = ${tokenHash}`,
  )
}

export async function markEmailVerificationUsed(db: Database, id: string): Promise<void> {
  await db.execute(sql`UPDATE email_verifications SET used_at = now() WHERE id = ${id}`)
}

export interface ApiKeyRow {
  id: string
  tenant_id: string
  name: string
  key_hash: string
  key_hint: string
  scopes: string[]
  created_by: string | null
  last_used_at: Date | null
  expires_at: Date | null
  revoked_at: Date | null
  created_at: Date
}

export async function createApiKey(
  db: Database,
  input: {
    tenantId: string
    name: string
    keyHash: string
    keyHint: string
    scopes?: string[]
    createdBy?: string
    expiresAt?: Date | null
  },
): Promise<ApiKeyRow> {
  const row = await one<ApiKeyRow>(
    db,
    sql`INSERT INTO api_keys (tenant_id, name, key_hash, key_hint, scopes, created_by, expires_at)
        VALUES (${input.tenantId}, ${input.name}, ${input.keyHash}, ${input.keyHint},
                ${json(input.scopes ?? [])}, ${input.createdBy ?? null}, ${input.expiresAt ?? null})
        RETURNING *`,
  )
  if (!row) throw new Error('创建 API Key 失败')
  return row
}

export async function listApiKeys(db: Database, tenantId: string): Promise<ApiKeyRow[]> {
  return rows<ApiKeyRow>(
    db,
    sql`SELECT * FROM api_keys WHERE tenant_id = ${tenantId}
        AND revoked_at IS NULL ORDER BY created_at DESC`,
  )
}

export async function revokeApiKey(
  db: Database,
  tenantId: string,
  keyId: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    sql`UPDATE api_keys SET revoked_at = now()
        WHERE id = ${keyId} AND tenant_id = ${tenantId} AND revoked_at IS NULL
        RETURNING id`,
  )
  return row !== null
}

export interface ApiKeyAuthRow {
  id: string
  tenant_id: string
  created_by: string | null
  scopes: string[]
  revoked_at: Date | null
  expires_at: Date | null
}

export async function findApiKeyByHash(
  db: Database,
  keyHash: string,
): Promise<ApiKeyAuthRow | null> {
  return one<ApiKeyAuthRow>(db, sql`SELECT * FROM find_api_key_by_hash(${keyHash})`)
}

export async function touchApiKey(db: Database, keyId: string): Promise<void> {
  await db.execute(sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${keyId}`)
}

export interface AuditLogRow {
  id: string
  tenant_id: string
  actor_type: string
  actor_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  ip: string | null
  user_agent: string | null
  detail: Record<string, unknown>
  created_at: Date
}

export async function insertAuditLog(
  db: Database,
  input: {
    tenantId: string
    actorType: string
    actorId?: string | null
    action: string
    targetType?: string
    targetId?: string
    ip?: string
    userAgent?: string
    detail?: Record<string, unknown>
  },
): Promise<void> {
  await db.execute(
    sql`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, action, target_type, target_id, ip, user_agent, detail)
        VALUES (${input.tenantId}, ${input.actorType}, ${input.actorId ?? null}, ${input.action},
                ${input.targetType ?? null}, ${input.targetId ?? null}, ${input.ip ?? null},
                ${input.userAgent ?? null}, ${json(input.detail ?? {})})`,
  )
}

export async function listAuditLogs(
  db: Database,
  tenantId: string,
  limit = 100,
): Promise<AuditLogRow[]> {
  return rows<AuditLogRow>(
    db,
    sql`SELECT * FROM audit_logs WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC LIMIT ${limit}`,
  )
}

export interface QuotaReservationResult {
  ok: boolean
  reason?: string
}

export async function reserveQuota(
  db: Database,
  tenantId: string,
  period: string,
  estimateUsd: number,
): Promise<QuotaReservationResult> {
  const limits = await one<{
    max_cost_usd: string
    max_jobs: number
    max_concurrency: number
  }>(
    db,
    sql`SELECT max_cost_usd, max_jobs, max_concurrency FROM quota_limits
        WHERE tenant_id = ${tenantId} FOR UPDATE`,
  )
  if (!limits) return { ok: false, reason: '配额未初始化' }

  const usage = await one<{
    cost_usd: string
    reserved_cost_usd: string
    job_count: number
  }>(
    db,
    sql`SELECT cost_usd, reserved_cost_usd, job_count FROM quota_usage
        WHERE tenant_id = ${tenantId} AND period = ${period}`,
  )
  const running = await one<{ count: number }>(
    db,
    sql`SELECT COUNT(*)::int AS count FROM jobs
        WHERE tenant_id = ${tenantId} AND status IN ('provisioning','running','finalizing')`,
  )

  const cost = Number(usage?.cost_usd ?? 0)
  const reserved = Number(usage?.reserved_cost_usd ?? 0)
  if (cost + reserved + estimateUsd > Number(limits.max_cost_usd)) {
    return { ok: false, reason: '本月额度不足' }
  }
  if ((usage?.job_count ?? 0) >= limits.max_jobs) {
    return { ok: false, reason: '本月任务数已达上限' }
  }
  if ((running?.count ?? 0) >= limits.max_concurrency) {
    return { ok: false, reason: '并发任务已达上限' }
  }

  await db.execute(
    sql`INSERT INTO quota_usage (tenant_id, period, reserved_cost_usd)
        VALUES (${tenantId}, ${period}, ${estimateUsd})
        ON CONFLICT (tenant_id, period) DO UPDATE
        SET reserved_cost_usd = quota_usage.reserved_cost_usd + EXCLUDED.reserved_cost_usd,
            updated_at = now()`,
  )
  return { ok: true }
}

export async function releaseQuota(
  db: Database,
  tenantId: string,
  period: string,
  estimateUsd: number,
): Promise<void> {
  await db.execute(
    sql`UPDATE quota_usage
        SET reserved_cost_usd = GREATEST(0, reserved_cost_usd - ${estimateUsd}),
            updated_at = now()
        WHERE tenant_id = ${tenantId} AND period = ${period}`,
  )
}

export function periodOf(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export type { SQL }

export async function listAssetStorageKeys(db: Database): Promise<string[]> {
  const result = await rows<{ storage_key: string }>(
    db,
    sql`SELECT storage_key FROM asset_versions`,
  )
  return result.map((row) => row.storage_key)
}
