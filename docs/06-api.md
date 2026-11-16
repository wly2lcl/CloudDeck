# 06 API

Base：`/v1`。所有请求/响应 `application/json`（上传与事件流除外）。

## 认证

| 方式 | 用途 |
|---|---|
| `Authorization: Bearer <access_token>` | Web / 移动端 |
| `X-Api-Key: cdk_...` | 服务端集成 |

- access token 15 分钟，refresh token 30 天，均可撤销。
- 每个请求解析出 `{ userId, tenantId, role }`；`X-Tenant-Id` 可由属于多租户的用户显式指定，缺省取最近使用租户。
- 移动端使用设备维度 refresh，可单独下线设备。

## 通用约定

- 响应信封：`{ "data": ..., "requestId": "..." }`；错误：`{ "error": { "code", "message", "details" }, "requestId" }`。
- 分页：`?limit=20&cursor=<opaque>`，响应带 `nextCursor`。不使用 offset。
- 幂等：`POST` 支持 `Idempotency-Key`，24 小时内相同 key 返回同一结果。
- 时间统一 UTC ISO 8601，字段 camelCase。
- 所有列表接口强制按租户过滤。

## 错误码

| code | HTTP | 含义 |
|---|---|---|
| `UNAUTHENTICATED` | 401 | 未登录/过期 |
| `FORBIDDEN` | 403 | 无权限或跨租户访问 |
| `NOT_FOUND` | 404 | 资源不存在（跨租户也返回 404） |
| `VALIDATION_FAILED` | 422 | 参数或 manifest 校验失败 |
| `QUOTA_EXCEEDED` | 402 | 配额不足 |
| `BUDGET_EXCEEDED` | 409 | job 运行超预算 |
| `CAPABILITY_UNAVAILABLE` | 409 | 能力停用或无可用 driver |
| `DRIVER_ERROR` | 502 | 引擎失败（附 driver id 与原始码） |
| `RATE_LIMITED` | 429 | 触发限流，带 `Retry-After` |
| `INTERNAL` | 500 | 未知错误 |

## 端点

### 账号

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | 注册（邀请码可选） |
| POST | `/auth/login` | 登录，返回 access/refresh |
| POST | `/auth/refresh` | 刷新 |
| POST | `/auth/logout` | 撤销当前会话 |
| POST | `/auth/forgot-password` | 发送重置令牌（`AUTH_EXPOSE_TOKENS=true` 时直接返回） |
| POST | `/auth/reset-password` | 重置密码并吊销该用户全部会话 |
| POST | `/auth/verify-email` | 验证邮箱 |
| POST | `/auth/accept-invite` | 接受邀请并加入租户 |
| GET | `/me` | 当前用户与租户列表 |
| GET/POST | `/tenants` | 创建/列出租户 |
| GET/POST | `/tenants/:id/members` | 成员列表 / 添加已注册用户 |
| PATCH/DELETE | `/tenants/:id/members/:userId` | 修改角色 / 移除成员 |
| GET/POST | `/api-keys` | 服务端密钥列表 / 创建（创建时返回一次明文） |
| DELETE | `/api-keys/:id` | 撤销密钥 |
| GET | `/audit-logs` | 租户审计日志（owner/admin） |
| GET | `/tenant-invitations` | 待接受邀请 |
| GET | `/admin/tenants` | 跨租户列表（平台管理员） |
| PATCH | `/admin/tenants/:id/plan` | 调整套餐 |
| PATCH | `/admin/tenants/:id/quota` | 覆盖配额 |
| GET | `/admin/jobs` | 跨租户任务 |
| PATCH | `/admin/capabilities/:id` | 全局启用/停用能力 |
| GET | `/tenant` | 当前租户与角色 |
| PATCH | `/tenant` | 切换套餐（owner/admin） |

### 项目与资产

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/projects` | 列表/创建 |
| GET/PATCH/DELETE | `/projects/:id` | 详情/更新/软删 |
| GET | `/projects/:id/graph` | 内容链（资产派生图） |
| POST | `/projects/:id/assets` | 创建资产（先拿上传凭证） |
| GET | `/assets/:id` | 元数据 + 版本列表 |
| GET | `/assets/:id/versions/:v/download` | 302 到签名 URL |
| POST | `/assets/:id/versions` | 新增版本 |
| GET | `/assets/:id/links` | 上下游关系 |
| GET | `/projects/:id/graph` | 内容链：资产节点与派生边 |

上传流程：
1. `POST /projects/:id/assets` 带 `{name,type,mime,size}` → 返回 `uploadUrl` 与 `assetId`。
2. 客户端直传对象存储。
3. `POST /assets/:id/versions/confirm` 带 checksum → 服务端校验后生成版本。

> M1 实现说明：当前采用控制面中转的 `multipart/form-data` 上传（`POST /projects/:id/assets?type=&name=`），预签名直传在 M2 接入。接口路径与资产语义保持不变，客户端后续只需切换上传通道。

### 能力

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/capabilities` | 当前租户可用能力（含 manifest 摘要与 ui schema） |
| GET | `/capabilities/:id` | 完整 manifest（含 form schema） |
| GET | `/capabilities/:id/estimate` | 按输入估算成本与时长 |
| GET | `/capabilities/:id/versions` | 历史版本 |
| GET | `/capabilities/states` | 当前租户的能力开关状态 |
| PUT | `/capabilities/:id/enabled` | 启用/停用能力（owner/admin） |

客户端不硬编码能力 id；首页与导航由该接口驱动。

### 任务

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects/:id/jobs` | 创建 job，返回 `jobId` |
| GET | `/jobs/:id` | 状态、用量、错误 |
| POST | `/jobs/:id/cancel` | 取消（幂等） |
| POST | `/jobs/:id/retry` | 失败重试，生成新 job |
| POST | `/jobs/:id/resume` | 续作（`resumable` 能力） |
| GET | `/jobs/:id/events` | SSE 事件流，支持 `Last-Event-ID` |
| GET | `/jobs/:id/logs` | 分页日志（脱敏后） |
| GET | `/jobs?projectId=&status=` | 列表 |

创建请求：

```json
{
  "capabilityId": "audiobook.render",
  "capabilityVersion": "1.2.0",
  "inputs": [{ "assetId": "ast_...", "version": 3 }],
  "params": { "language": "zh", "chapterRange": "1-20" },
  "budgetUsd": 3
}
```

响应：`{ "jobId": "job_...", "status": "queued", "estimatedCostUsd": 2.31 }`

### 计费

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/billing/usage?period=2026-11` | 本期总用量 |
| GET | `/billing/summary?period=2026-11` | 按能力/驱动/单位聚合 |
| GET | `/billing/statement?period=2026-11` | 月度对账单（明细 + 总额 + 任务数） |
| GET/POST | `/projects/:id/comments` | 项目评论列表 / 新增 |
| DELETE | `/comments/:id` | 删除评论（作者或 owner/admin） |
| GET | `/templates` | 项目模板列表 |
| POST | `/templates` | 创建模板 |
| DELETE | `/templates/:id` | 删除模板 |
| POST | `/templates/:id/projects` | 用模板创建项目 |
| POST | `/projects/:id/shares` | 创建只读分享（返回 token 与 url） |
| GET | `/projects/:id/shares` | 列出分享（不含 token） |
| DELETE | `/shares/:id` | 撤销分享 |
| GET | `/public/shares/:token` | 公开读取项目与资产元数据 |
| GET | `/public/shares/:token/assets/:id/content` | 公开文本预览 |
| GET | `/billing/quota` | 配额与已用量 |
| GET | `/billing/invoices` | 账单（M5） |
| GET/POST/DELETE | `/model-credentials` | 租户自有模型密钥（BYOK） |
| GET | `/model-credentials/:id/verify` | 验证密文可解密（不返回明文） |
| POST | `/model-credentials/rotate` | 用当前主密钥重加密全部凭据 |
| GET | `/billing/reconciliation` | 按任务比较预估与实际用量 |
| POST | `/billing/invoices` | 生成/获取月度账单快照 |
| GET | `/billing/invoices` | 账单列表 |
| GET | `/billing/invoices/:id` | 账单详情与快照 |
| GET | `/billing/invoices/:id/html` | 可打印账单 HTML |
| POST | `/billing/checkout` | 创建套餐支付单（owner/admin） |
| POST | `/billing/webhook/:provider` | 支付回调（HMAC 签名，无登录态） |
| GET | `/billing/payments` | 支付单列表 |
| POST/DELETE | `/devices`、`/devices/:token` | 注册/删除设备推送令牌 |
| GET | `/templates/public` | 公开模板市场 |
| POST | `/templates/public/:id/import` | 导入公开模板 |
| PATCH | `/templates/:id/public` | 公开/取消公开（owner/admin） |
| GET | `/projects/:id/comments/stream` | 评论 SSE 增量流 |
| GET | `/metrics` | Prometheus 文本指标 |

## SSE

```text
GET /v1/jobs/:id/events
Accept: text/event-stream
Last-Event-ID: 1042
```

- 事件类型：`job.event`、`job.end`、`ping`。
- 单连接最多 1 小时，客户端到期重连。
- 日志类事件默认只推 `info` 以上；`debug` 需 `?level=debug` 且仅管理员可用。
- 服务端按 `seq` 补发，保证至少一次；客户端按 `seq` 去重。

## 速率限制

| 维度 | 默认 |
|---|---|
| 每用户 API | 120 req/min |
| 每租户并发 job | 按 tier：free 1 / pro 4 / team 16 |
| SSE 连接 | 每用户 5 条 |
| 上传 | 单文件 2GB，分片 |

超限返回 429 + `Retry-After`。

## Webhook（M4）

`job.succeeded` / `job.failed` / `job.cancelled` 可订阅。签名 `X-CloudDeck-Signature`（HMAC-SHA256，`timestamp + "." + body`），当前重试 3 次。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/webhooks` | 列出 / 创建（secret 仅创建时返回） |
| DELETE | `/webhooks/:id` | 删除 |
| GET | `/webhook-deliveries` | 最近 100 条投递记录 |
| POST | `/webhook-deliveries/:id/replay` | 手动重放一次投递（owner/admin） |

## OpenAPI

- 由 `packages/contracts` 生成 `openapi.yaml`，CI 校验与实现一致。
- 客户端 SDK（TS）由 OpenAPI 生成；移动端复用同一 SDK。
- 破坏性变更必须新增 `/v2`，并保留 `/v1` 至少 6 个月。
