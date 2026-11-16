import {
  getAsset,
  getProject,
  hasProjectMembers,
  isProjectMember,
  type AssetRow,
  type Database,
  type ProjectRow,
} from '@clouddeck/db'
import type { AuthContext } from './auth'
import { AppError } from './errors'

/**
 * 项目默认对租户内成员可见；一旦显式添加了 project_members，
 * 仅成员与 owner/admin 可访问，其余人统一返回 404 避免泄露存在性。
 */
export async function assertProjectAccess(
  db: Database,
  auth: AuthContext,
  projectId: string,
): Promise<ProjectRow> {
  const project = await getProject(db, auth.tenantId, projectId)
  if (!project) throw new AppError('NOT_FOUND', '项目不存在')
  if (auth.role === 'owner' || auth.role === 'admin') return project
  if (!(await hasProjectMembers(db, auth.tenantId, projectId))) return project
  if (await isProjectMember(db, auth.tenantId, projectId, auth.userId)) return project
  throw new AppError('NOT_FOUND', '项目不存在')
}

export async function assertAssetAccess(
  db: Database,
  auth: AuthContext,
  assetId: string,
): Promise<AssetRow> {
  const asset = await getAsset(db, auth.tenantId, assetId)
  if (!asset) throw new AppError('NOT_FOUND', '资产不存在')
  await assertProjectAccess(db, auth, asset.project_id)
  return asset
}
