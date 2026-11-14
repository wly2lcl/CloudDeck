import type { JobStatus } from './events'

export const JOB_TRANSITIONS = {
  queued: ['provisioning', 'cancelled'],
  provisioning: ['running', 'failed', 'cancelled'],
  running: ['finalizing', 'failed', 'cancelled'],
  finalizing: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<JobStatus, readonly JobStatus[]>

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return (JOB_TRANSITIONS[from] as readonly JobStatus[]).includes(to)
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}
