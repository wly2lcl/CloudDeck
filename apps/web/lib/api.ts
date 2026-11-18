export interface Envelope<T> {
  data: T
  requestId: string
}

export interface HealthData {
  status: string
  service: string
  version: string
  time: string
}

export interface Project {
  id: string
  name: string
  description: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export interface Asset {
  assetId: string
  projectId: string
  type: string
  name: string
  mime: string
  size: number
  latestVersion: number
  createdAt: string
}

export interface CapabilitySummary {
  id: string
  version: string
  name: string
  category: string
  description: string
  icon: string | null
  tags: string[]
  estimate: number
  unit: string
  ui: { form: string; result: string }
}

export interface CapabilityDetail extends CapabilitySummary {
  manifest: {
    inputs: { name: string; label?: string; assetTypes: string[]; required: boolean }[]
    outputs: { name: string; assetType: string; multiple: boolean }[]
    execution: { mode: string; maxDurationMs: number; maxCostUsd: number }
    billing: { unit: string; estimate: number }
  }
  form: JsonSchema | null
}

export interface JsonSchema {
  type: string
  properties?: Record<
    string,
    { type?: string; title?: string; default?: unknown; minimum?: number; maximum?: number; enum?: string[] }
  >
}

export interface Tenant {
  id: string
  name: string
  slug: string
  tier: 'free' | 'pro' | 'team'
  status: string
  role: string
  createdAt: string
}

export interface Quota {
  period: string
  maxCostUsd: number
  maxJobs: number
  maxConcurrency: number
  costUsd: number
  jobCount: number
  running: number
}

export interface CapabilityState {
  id: string
  name: string
  category: string
  enabled: boolean
}

export interface Template {
  id: string
  name: string
  description: string | null
  payload: Record<string, unknown>
  isPublic: boolean
  createdAt: string
}

export interface PublicTemplate {
  id: string
  name: string
  description: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface Reconciliation {
  period: string
  jobs: {
    jobId: string
    capabilityId: string
    status: string
    estimatedCostUsd: number
    actualCostUsd: number
    varianceUsd: number
  }[]
  totals: { estimatedCostUsd: number; actualCostUsd: number }
}

export interface Invoice {
  id: string
  period: string
  totalUsd: number
  jobCount: number
  status: string
  createdAt: string
  snapshot?: Record<string, unknown>
}

export interface BillingSummary {
  period: string
  items: {
    capabilityId: string
    driverId: string
    unit: string
    quantity: number
    amountUsd: number
    entries: number
  }[]
}

export interface ModelCredential {
  id: string
  provider: string
  label: string
  keyHint: string
  status: string
  createdAt: string
}

export interface Comment {
  id: string
  projectId: string
  assetId: string | null
  body: string
  author: string
  createdAt: string
  canDelete: boolean
}

export interface PublicShare {
  project: { id: string; name: string; description: string | null }
  assets: GraphAsset[]
  links: { fromAssetId: string; toAssetId: string; relation: string }[]
}

export interface GraphAsset {
  assetId: string
  type: string
  name: string
  latestVersion: number
}

export interface GraphLink {
  fromAssetId: string
  fromVersion: number
  toAssetId: string
  toVersion: number
  relation: string
}

export interface ProjectGraph {
  assets: GraphAsset[]
  links: GraphLink[]
}

export interface Job {
  jobId: string
  projectId: string
  capabilityId: string
  capabilityVersion: string
  status: string
  driverId: string
  params: Record<string, unknown>
  inputs: { assetId: string; version: number }[]
  outputs: { assetId: string; version: number; name: string; type: string }[]
  estimatedCostUsd: number
  actualCostUsd: number
  errorCode: string | null
  errorMessage: string | null
  cancelRequested: boolean
  resumable: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface JobEvent {
  seq: number
  type: 'log' | 'progress' | 'partial' | 'artifact' | 'usage' | 'error' | 'done'
  percent?: number
  message?: string
  level?: string
  costUsd?: number
  code?: string
  spec?: { name?: string }
  at: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4310'

export function getApiBase(): string {
  return API_BASE
}
const ACCESS_KEY = 'clouddeck.access'
const REFRESH_KEY = 'clouddeck.refresh'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_KEY, accessToken)
  localStorage.setItem(REFRESH_KEY, refreshToken)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACCESS_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_KEY)
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  formData?: FormData
  auth?: boolean
}

let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = getRefreshToken()
      if (!refreshToken) return null
      const response = await fetch(`${API_BASE}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      })
      if (!response.ok) {
        clearTokens()
        return null
      }
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { accessToken?: string; refreshToken?: string }
      }
      if (!payload.data?.accessToken || !payload.data.refreshToken) {
        clearTokens()
        return null
      }
      setTokens(payload.data.accessToken, payload.data.refreshToken)
      return payload.data.accessToken
    })().finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

async function send(
  path: string,
  options: RequestOptions,
  tokenOverride?: string,
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.auth !== false) {
    const token = tokenOverride ?? getToken()
    if (token) headers.authorization = `Bearer ${token}`
  }

  let body: BodyInit | undefined
  if (options.formData) {
    body = options.formData
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  return fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    cache: 'no-store',
  })
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options)
  if (response.status === 401 && options.auth !== false && path !== '/v1/auth/refresh') {
    const token = await refreshAccessToken()
    if (token) response = await send(path, options, token)
  }

  const payload = (await response.json().catch(() => ({}))) as {
    data?: T
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    throw new ApiError(
      payload.error?.code ?? 'INTERNAL',
      payload.error?.message ?? `请求失败（${response.status}）`,
      response.status,
    )
  }
  return payload.data as T
}

export async function getHealth(): Promise<Envelope<HealthData>> {
  const response = await fetch(`${API_BASE}/healthz`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`控制面返回 ${response.status}`)
  return (await response.json()) as Envelope<HealthData>
}

export async function getModelCredentials(): Promise<ModelCredential[]> {
  return api<ModelCredential[]>('/v1/model-credentials')
}

export async function createModelCredential(input: {
  provider: string
  label: string
  secret: string
}): Promise<ModelCredential> {
  return api<ModelCredential>('/v1/model-credentials', { method: 'POST', body: input })
}

export async function deleteModelCredential(id: string): Promise<void> {
  await api(`/v1/model-credentials/${id}`, { method: 'DELETE' })
}

export async function getComments(projectId: string): Promise<Comment[]> {
  return api<Comment[]>(`/v1/projects/${projectId}/comments`)
}

export async function addComment(projectId: string, body: string): Promise<Comment> {
  return api<Comment>(`/v1/projects/${projectId}/comments`, {
    method: 'POST',
    body: { body },
  })
}

export async function deleteComment(id: string): Promise<void> {
  await api(`/v1/comments/${id}`, { method: 'DELETE' })
}

export async function getTenant(): Promise<Tenant> {
  return api<Tenant>('/v1/tenant')
}

export async function updateTenantPlan(tier: Tenant['tier']): Promise<Tenant> {
  return api<Tenant>('/v1/tenant', { method: 'PATCH', body: { tier } })
}

export async function getQuota(): Promise<Quota> {
  return api<Quota>('/v1/billing/quota')
}

export async function getCapabilityStates(): Promise<CapabilityState[]> {
  return api<CapabilityState[]>('/v1/capabilities/states')
}

export async function setCapabilityEnabled(id: string, enabled: boolean): Promise<void> {
  await api(`/v1/capabilities/${id}/enabled`, { method: 'PUT', body: { enabled } })
}

export async function getTemplates(): Promise<Template[]> {
  return api<Template[]>('/v1/templates')
}

export async function createTemplate(input: {
  name: string
  description?: string
}): Promise<Template> {
  return api<Template>('/v1/templates', { method: 'POST', body: input })
}

export async function deleteTemplate(id: string): Promise<void> {
  await api(`/v1/templates/${id}`, { method: 'DELETE' })
}

export async function createProjectFromTemplate(id: string): Promise<Project> {
  return api<Project>(`/v1/templates/${id}/projects`, { method: 'POST', body: {} })
}

export async function getBillingSummary(period?: string): Promise<BillingSummary> {
  return api<BillingSummary>(`/v1/billing/summary${period ? `?period=${period}` : ''}`)
}

export async function getBillingReconciliation(period?: string): Promise<Reconciliation> {
  return api<Reconciliation>(
    `/v1/billing/reconciliation${period ? `?period=${period}` : ''}`,
  )
}

export async function createInvoice(period?: string): Promise<Invoice> {
  return api<Invoice>(`/v1/billing/invoices${period ? `?period=${period}` : ''}`, {
    method: 'POST',
    body: {},
  })
}

export async function getInvoices(): Promise<Invoice[]> {
  return api<Invoice[]>('/v1/billing/invoices')
}

export async function getPublicTemplates(): Promise<PublicTemplate[]> {
  return api<PublicTemplate[]>('/v1/templates/public')
}

export async function setTemplatePublic(id: string, isPublic: boolean): Promise<void> {
  await api(`/v1/templates/${id}/public`, { method: 'PATCH', body: { isPublic } })
}

export async function importPublicTemplate(id: string): Promise<Template> {
  return api<Template>(`/v1/templates/public/${id}/import`, { method: 'POST', body: {} })
}

export async function createShare(
  projectId: string,
  expiresInDays = 7,
): Promise<{ id: string; token: string; url: string; expiresAt: string | null }> {
  return api(`/v1/projects/${projectId}/shares`, {
    method: 'POST',
    body: { expiresInDays },
  })
}

export async function getPublicShare(token: string): Promise<PublicShare> {
  return api<PublicShare>(`/v1/public/shares/${token}`, { auth: false })
}

export async function getPublicAssetContent(
  token: string,
  assetId: string,
): Promise<{ name: string; mime: string; text: string }> {
  return api(`/v1/public/shares/${token}/assets/${assetId}/content`, { auth: false })
}

export async function getProjectGraph(projectId: string): Promise<ProjectGraph> {
  return api<ProjectGraph>(`/v1/projects/${projectId}/graph`)
}

export async function getAssetContent(
  assetId: string,
  version: number,
): Promise<{ mime: string; text: string }> {
  return api<{ mime: string; text: string }>(
    `/v1/assets/${assetId}/versions/${version}/content`,
  )
}

export async function getAssetUrl(
  assetId: string,
  version: number,
): Promise<{ url: string; mime: string }> {
  return api<{ url: string; mime: string }>(`/v1/assets/${assetId}/versions/${version}/url`)
}

export async function downloadAsset(assetId: string, version: number): Promise<void> {
  const token = getToken()
  const response = await fetch(`${API_BASE}/v1/assets/${assetId}/versions/${version}/download`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`下载失败（${response.status}）`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${assetId}-v${version}`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function streamComments(
  projectId: string,
  onComment: (comment: Comment) => void,
): () => void {
  const controller = new AbortController()
  const token = getToken()

  void (async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/projects/${projectId}/comments/stream`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error('评论流连接失败')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let index = buffer.indexOf('\n\n')
        while (index >= 0) {
          const chunk = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          index = buffer.indexOf('\n\n')

          let eventName = 'message'
          let data = ''
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim()
            if (line.startsWith('data: ')) data += line.slice(6)
          }
          if (eventName === 'comment' && data) {
            try {
              onComment(JSON.parse(data) as Comment)
            } catch {
              // 忽略无法解析的评论
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') console.error(error)
    }
  })()

  return () => controller.abort()
}

export function streamJobEvents(
  jobId: string,
  onEvent: (event: JobEvent) => void,
  onEnd: () => void,
): () => void {
  const controller = new AbortController()
  const token = getToken()

  void (async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/jobs/${jobId}/events`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error('事件流连接失败')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let index = buffer.indexOf('\n\n')
        while (index >= 0) {
          const chunk = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          index = buffer.indexOf('\n\n')

          let eventName = 'message'
          let data = ''
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim()
            if (line.startsWith('data: ')) data += line.slice(6)
          }
          if (eventName === 'job.end') {
            onEnd()
            controller.abort()
            return
          }
          if (eventName === 'job.event' && data) {
            try {
              onEvent(JSON.parse(data) as JobEvent)
            } catch {
              // 忽略无法解析的事件
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') console.error(error)
    }
  })()

  return () => controller.abort()
}

export async function forgotPassword(email: string): Promise<{ sent: boolean; token?: string }> {
  return api('/v1/auth/forgot-password', { method: 'POST', body: { email }, auth: false })
}

export async function resetPassword(token: string, password: string): Promise<{ reset: boolean }> {
  return api('/v1/auth/reset-password', { method: 'POST', body: { token, password }, auth: false })
}

export interface Member {
  userId: string
  email: string
  displayName: string | null
  role: string
  status: string
  joinedAt: string
}

export interface ApiKey {
  id: string
  name: string
  hint: string
  scopes: string[]
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export interface AuditLog {
  id: string
  actorType: string
  actorId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  ip: string | null
  createdAt: string
}

export async function getMembers(tenantId: string): Promise<Member[]> {
  return api<Member[]>(`/v1/tenants/${tenantId}/members`)
}

export type AddMemberResult =
  | Member
  | { invited: true; email: string; role: string; token?: string }

export async function addMember(
  tenantId: string,
  email: string,
  role: string,
): Promise<AddMemberResult> {
  return api<AddMemberResult>(`/v1/tenants/${tenantId}/members`, {
    method: 'POST',
    body: { email, role },
  })
}

export async function updateMemberRole(
  tenantId: string,
  userId: string,
  role: string,
): Promise<{ userId: string; role: string }> {
  return api(`/v1/tenants/${tenantId}/members/${userId}`, {
    method: 'PATCH',
    body: { role },
  })
}

export async function removeMember(tenantId: string, userId: string): Promise<void> {
  await api(`/v1/tenants/${tenantId}/members/${userId}`, { method: 'DELETE' })
}

export async function getApiKeys(): Promise<ApiKey[]> {
  return api<ApiKey[]>('/v1/api-keys')
}

export async function createApiKey(name: string): Promise<ApiKey & { key: string }> {
  return api<ApiKey & { key: string }>('/v1/api-keys', { method: 'POST', body: { name } })
}

export async function revokeApiKey(id: string): Promise<void> {
  await api(`/v1/api-keys/${id}`, { method: 'DELETE' })
}

export async function getAuditLogs(limit = 20): Promise<AuditLog[]> {
  return api<AuditLog[]>(`/v1/audit-logs?limit=${limit}`)
}

export interface Me {
  user: { id: string; email: string; displayName: string | null; emailVerified: boolean }
  tenants: { id: string; name: string; slug: string; tier: string; role: string }[]
  activeTenantId: string
  platformAdmin?: boolean
}

export interface AdminTenant {
  id: string
  name: string
  slug: string
  tier: string
  createdAt: string
  quota: {
    maxCostUsd: number
    maxJobs: number
    maxConcurrency: number
    costUsd: number
    reservedCostUsd: number
    jobCount: number
    running: number
  } | null
}

export interface AdminJob {
  id: string
  tenantId: string
  tenantName: string
  capabilityId: string
  status: string
  estimatedCostUsd: number
  actualCostUsd: number
  createdAt: string
  finishedAt: string | null
}

export async function getMe(): Promise<Me> {
  return api<Me>('/v1/me')
}

export async function getAdminTenants(): Promise<AdminTenant[]> {
  return api<AdminTenant[]>('/v1/admin/tenants')
}

export async function updateAdminPlan(tenantId: string, tier: string): Promise<void> {
  await api(`/v1/admin/tenants/${tenantId}/plan`, { method: 'PATCH', body: { tier } })
}

export async function updateAdminQuota(
  tenantId: string,
  quota: { maxCostUsd: number; maxJobs: number; maxConcurrency: number },
): Promise<void> {
  await api(`/v1/admin/tenants/${tenantId}/quota`, { method: 'PATCH', body: quota })
}

export async function getAdminJobs(): Promise<AdminJob[]> {
  return api<AdminJob[]>('/v1/admin/jobs?limit=50')
}

export async function acceptInvite(
  token: string,
  password: string,
  displayName?: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  return api('/v1/auth/accept-invite', {
    method: 'POST',
    body: { token, password, displayName },
    auth: false,
  })
}

export async function verifyEmail(token: string): Promise<{ verified: boolean }> {
  return api('/v1/auth/verify-email', { method: 'POST', body: { token }, auth: false })
}

export interface VoiceProfile {
  id: string
  name: string
  provider: string
  voiceId: string
  roleMap: Record<string, string>
  description: string | null
  createdAt: string
}

export async function getVoiceProfiles(): Promise<VoiceProfile[]> {
  return api<VoiceProfile[]>('/v1/voice-profiles')
}

export async function createVoiceProfile(input: {
  name: string
  provider: string
  voiceId: string
  roleMap: Record<string, string>
  description?: string
}): Promise<VoiceProfile> {
  return api<VoiceProfile>('/v1/voice-profiles', { method: 'POST', body: input })
}

export async function deleteVoiceProfile(id: string): Promise<void> {
  await api(`/v1/voice-profiles/${id}`, { method: 'DELETE' })
}

export interface SubtitleStylePreset {
  id: string
  name: string
  style: Record<string, string>
  version: number
  createdAt: string
}

export interface SubtitleStylePresetVersion {
  id: string
  version: number
  style: Record<string, string>
  createdAt: string
}

export async function getSubtitleStylePresets(): Promise<SubtitleStylePreset[]> {
  return api<SubtitleStylePreset[]>('/v1/subtitle-style-presets')
}

export async function createSubtitleStylePreset(
  name: string,
  style: Record<string, string>,
): Promise<SubtitleStylePreset> {
  return api<SubtitleStylePreset>('/v1/subtitle-style-presets', {
    method: 'POST',
    body: { name, style },
  })
}

export async function deleteSubtitleStylePreset(id: string): Promise<void> {
  await api(`/v1/subtitle-style-presets/${id}`, { method: 'DELETE' })
}

export async function exportSubtitleStylePresets(): Promise<{
  version: number
  presets: { name: string; style: Record<string, string> }[]
}> {
  return api('/v1/subtitle-style-presets/export')
}

export async function importSubtitleStylePresets(
  presets: { name: string; style: Record<string, string> }[],
): Promise<{ imported: number }> {
  return api('/v1/subtitle-style-presets/import', { method: 'POST', body: { presets } })
}

export async function getSubtitleStylePresetVersions(
  id: string,
): Promise<SubtitleStylePresetVersion[]> {
  return api<SubtitleStylePresetVersion[]>(`/v1/subtitle-style-presets/${id}/versions`)
}

export async function restoreSubtitleStylePreset(
  id: string,
  version: number,
): Promise<SubtitleStylePreset> {
  return api<SubtitleStylePreset>(
    `/v1/subtitle-style-presets/${id}/versions/${version}/restore`,
    { method: 'POST' },
  )
}
