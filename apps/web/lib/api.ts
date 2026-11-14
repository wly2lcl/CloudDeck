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
  createdAt: string
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
  at: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4310'
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

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.auth !== false) {
    const token = getToken()
    if (token) headers.authorization = `Bearer ${token}`
  }

  let body: BodyInit | undefined
  if (options.formData) {
    body = options.formData
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    cache: 'no-store',
  })

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
