import type { AssetType } from './asset'
import type { OutputSpec } from './capability'
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

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut?: boolean
  aborted?: boolean
}

export interface CommandOptions {
  cwd: string
  env?: Record<string, string>
  stdin?: string
  timeoutMs?: number
  signal?: AbortSignal
  maxOutputBytes?: number
}

/** 驱动通过该接口启动子进程，由 runner 注入沙箱实现。 */
export interface CommandRunner {
  run(command: string, args: string[], options: CommandOptions): Promise<CommandResult>
  /** 可选：按块回传 stdout，驱动据此实时映射事件。 */
  runStream?(
    command: string,
    args: string[],
    options: CommandOptions,
    onStdout: (chunk: string) => void,
  ): Promise<CommandResult>
}

export interface TaskContext {
  jobId: string
  tenantId: string
  capability: {
    id: string
    version: string
    outputs?: OutputSpec[]
    systemPrompt?: string
  }
  params: Record<string, unknown>
  inputs: LocalAsset[]
  workspace: string
  outputDir: string
  env: Record<string, string>
  limits: JobLimits
  signal: AbortSignal
  commands: CommandRunner
}

export interface Driver {
  readonly id: string
  readonly protocolVersion: typeof DRIVER_PROTOCOL_VERSION
  submit(ctx: TaskContext): Promise<{ externalId?: string }>
  events(ctx: TaskContext): AsyncIterable<JobEvent>
  cancel(ctx: TaskContext): Promise<void>
  collect(ctx: TaskContext): Promise<ArtifactSpec[]>
}
