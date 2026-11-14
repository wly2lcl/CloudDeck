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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4310'

export async function getHealth(): Promise<Envelope<HealthData>> {
  const response = await fetch(`${API_BASE}/healthz`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`控制面返回 ${response.status}`)
  }
  return (await response.json()) as Envelope<HealthData>
}
