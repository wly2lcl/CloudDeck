export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'QUOTA_EXCEEDED'
  | 'BUDGET_EXCEEDED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'DRIVER_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL'

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  QUOTA_EXCEEDED: 402,
  BUDGET_EXCEEDED: 409,
  CAPABILITY_UNAVAILABLE: 409,
  DRIVER_ERROR: 502,
  RATE_LIMITED: 429,
  INTERNAL: 500,
}

export class AppError extends Error {
  readonly statusCode: number

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = STATUS_BY_CODE[code]
  }
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode
    message: string
    details?: unknown
  }
  requestId: string
}

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    error: details === undefined ? { code, message } : { code, message, details },
    requestId,
  }
}
