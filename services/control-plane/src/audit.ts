import { insertAuditLog, withTenant, type Database } from '@clouddeck/db'

export interface AuditInput {
  tenantId: string
  actorType: string
  actorId?: string | null
  action: string
  targetType?: string
  targetId?: string
  ip?: string
  userAgent?: string
  detail?: Record<string, unknown>
}

/** 审计失败不应影响主流程，只记录错误。 */
export async function audit(db: Database, input: AuditInput): Promise<void> {
  try {
    await withTenant(db, input.tenantId, (tx) => insertAuditLog(tx, input))
  } catch (error) {
    console.error('审计写入失败', error)
  }
}
