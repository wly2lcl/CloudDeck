import type { AssetType } from './asset'
import type { ArtifactSpec, JobEvent } from './events'

export const DRIVER_PROTOCOL_VERSION = 1 as const

export interface LocalAsset {
  assetId: string
  version: number
  type: AssetType
  path: string
  mime: string
}

export interface JobLimits {
  maxDurationMs: number
  maxCostUsd: number
  maxOutputBytes: number
}

export interface TaskContext {
  jobId: string
  tenantId: string
  capability: { id: string; version: string }
  params: Record<string, unknown>
  inputs: LocalAsset[]
  workspace: string
  outputDir: string
  env: Record<string, string>
  limits: JobLimits
  signal: AbortSignal
}

export interface Driver {
  readonly id: string
  readonly protocolVersion: typeof DRIVER_PROTOCOL_VERSION
  submit(ctx: TaskContext): Promise<{ externalId?: string }>
  events(ctx: TaskContext): AsyncIterable<JobEvent>
  cancel(ctx: TaskContext): Promise<void>
  collect(ctx: TaskContext): Promise<ArtifactSpec[]>
}
