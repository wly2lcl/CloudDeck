# 03 数据模型

单库多租户：所有业务表带 `tenant_id`，应用层强制过滤 + Postgres RLS 兜底。

## 租户与账号

```text
tenants(id, name, slug, tier, status, created_at)
users(id, email, password_hash, display_name, avatar_url, locale, created_at)
memberships(tenant_id, user_id, role, status, invited_by, created_at)
  role: owner | admin | editor | viewer
api_keys(id, tenant_id, name, key_hash, key_hint, scopes, last_used_at, expires_at, revoked_at)
sessions(id, user_id, tenant_id, refresh_token_hash, device, ip, expires_at)
```

规则：
- 一个用户可属于多个租户；`tenant_id` 必须在每次请求的会话上下文中明确。
- `api_keys.scopes` 形如 `assets:read,jobs:write`，不得授予 `tenants:admin` 给普通 key。
- 删除租户为软删，数据保留 30 天后物理清理。

## 项目与资产

```text
projects(
  id, tenant_id, name, description, cover_asset_id,
  status, created_by, created_at, updated_at, deleted_at
)

assets(
  id, tenant_id, project_id, type, name, mime, size_bytes,
  checksum_sha256, storage_key, meta jsonb,
  latest_version int, created_by, created_at
)

asset_versions(
  asset_id, version, storage_key, size_bytes, checksum_sha256,
  meta jsonb, created_by_job_id, created_at,
  PRIMARY KEY (asset_id, version)
)

asset_links(
  tenant_id, project_id,
  from_asset_id, from_version,
  to_asset_id, to_version,
  relation,              -- derived_from | references | adapts
  created_at
)
```

规则：
- `assets` 存当前指针，`asset_versions` 存不可变内容；任何写入先落 S3 再写版本行。
- 同一 `(tenant_id, project_id, type, name)` 默认视为同一资产的新版本，除非显式新建。
- `asset_links` 是内容链的唯一来源；删除资产只允许软删并保留链接，避免断链。
- `storage_key` 格式：`t/{tenant_id}/p/{project_id}/{asset_id}/v{version}/{filename}`。

## 任务

```text
jobs(
  id, tenant_id, project_id, capability_id, capability_version,
  status, driver_id, params jsonb,
  input_assets jsonb,          -- [{assetId, version}]
  output_assets jsonb,
  estimated_cost_usd numeric(12,4),
  actual_cost_usd numeric(12,4),
  error_code, error_message,
  retried_from_job_id, resume_count,
  created_by, started_at, finished_at, created_at, updated_at
)

job_events(
  job_id, seq bigint, type, payload jsonb, at,
  PRIMARY KEY (job_id, seq)
)

job_artifacts(
  id, job_id, tenant_id, asset_id, version, name, type, mime, size_bytes,
  created_at
)

job_sandboxes(
  job_id, container_id, node, started_at, ended_at, exit_code, oom_killed
)
```

规则：
- `job_events` 按月分区，保留 90 天；终态摘要长期保留在 `jobs`。
- `jobs.params` 必须通过能力 form schema 校验后才落库。
- 状态流转只能经控制面状态机，runner 通过内部接口上报，不允许直接 UPDATE。

## 计量与配额

```text
usage_ledger(
  id, tenant_id, job_id, capability_id, driver_id,
  unit, quantity numeric(16,4), unit_price numeric(12,6),
  amount_usd numeric(12,4), model, provider,
  occurred_at, created_at
)

quota_limits(tenant_id, period, max_cost_usd, max_jobs, max_concurrency)
quota_usage(tenant_id, period, cost_usd, reserved_cost_usd, job_count, updated_at)

model_credentials(
  id, tenant_id, provider, label, encrypted_secret, key_hint,
  status, created_by, created_at, last_used_at
)
```

规则：
- 计费以 `usage_ledger` 为唯一事实，按 `capability + driver + unit` 聚合。
- 预扣：提交 job 时按 `estimate` 冻结额度，结束时按实际结算多退少补。
- 超配额在提交阶段拒绝（`QUOTA_EXCEEDED`），超预算在运行中终止（`BUDGET_EXCEEDED`）。
- `encrypted_secret` 使用 KMS/主密钥信封加密，禁止明文落库与日志。

## 能力注册表

```text
capabilities(
  id, version, name, category, manifest jsonb,
  status,                    -- active | deprecated | disabled
  driver_default, created_at, updated_at,
  PRIMARY KEY (id, version)
)

capability_drivers(
  capability_id, driver_id, priority, config jsonb, enabled
)
```

规则：
- 启动时扫描 `capabilities/*/capability.yaml` 同步；生产环境写库需走管理接口。
- `status=deprecated` 的能力不出现在客户端列表，但在途 job 可继续。

## 审计

```text
project_members(tenant_id, project_id, user_id, role, created_at)
password_resets(id, user_id, token_hash, expires_at, used_at)
email_verifications(id, user_id, token_hash, expires_at, used_at)
audit_logs(
  id, tenant_id, actor_type, actor_id, action, target_type, target_id,
  ip, user_agent, detail jsonb, created_at
)
```

必须记录：登录、密钥增删、成员变更、能力启停、job 取消、数据导出、删除。

## 索引与约束

- 所有表 `(tenant_id, created_at)` 建索引；`jobs` 另建 `(tenant_id, status)`。
- `assets` 建 `(tenant_id, project_id, type)`；`asset_links` 建 `(tenant_id, from_asset_id)` 与 `(to_asset_id)`。
- 唯一约束：`users.email`、`tenants.slug`、`(asset_id, version)`、`(job_id, seq)`。
- 外键默认 `ON DELETE RESTRICT`；软删业务表不级联删除历史。

## ER 概览

```text
tenants 1─n memberships n─1 users
tenants 1─n projects
projects 1─n assets 1─n asset_versions
assets n─n assets  via asset_links（内容链）
projects 1─n jobs 1─n job_events
jobs 1─n job_artifacts n─1 assets
tenants 1─n usage_ledger n─1 jobs
```

## 内容链示例（小说 → 有声）

```text
story_bible (v3)
   └─ derived_from ─ novel_manuscript (v12)
                        ├─ derived_from ─ script (v2)
                        │                   └─ derived_from ─ storyboard (v1)
                        │                                        └─ video (v1)
                        └─ derived_from ─ voice_profile (v4)
                                            └─ audio_track (v5, 逐章)
```

查询「一部作品的全部产物」= 从项目根资产按 `asset_links` 做递归 CTE；客户端按链路渲染工序图，而不是按能力列表渲染。
