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
| GET | `/me` | 当前用户与租户列表 |
| GET/POST | `/tenants` | 创建/列出租户 |
| GET/POST/DELETE | `/tenants/:id/members` | 成员管理 |
| GET/POST/DELETE | `/api-keys` | 服务端密钥 |

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

上传流程：
1. `POST /projects/:id/assets` 带 `{name,type,mime,size}` → 返回 `uploadUrl` 与 `assetId`。
2. 客户端直传对象存储。
3. `POST /assets/:id/versions/confirm` 带 checksum → 服务端校验后生成版本。

### 能力

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/capabilities` | 当前租户可用能力（含 manifest 摘要与 ui schema） |
| GET | `/capabilities/:id` | 完整 manifest（含 form schema） |
| GET | `/capabilities/:id/estimate` | 按输入估算成本与时长 |
| GET | `/capabilities/:id/versions` | 历史版本 |

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
| GET | `/billing/usage?period=2026-11` | 按能力/模型聚合 |
| GET | `/billing/quota` | 配额与已用量 |
| GET | `/billing/invoices` | 账单（M5） |
| GET/POST/DELETE | `/model-credentials` | 租户自有模型密钥（BYOK） |

## SSE

```
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

`job.succeeded` / `job.failed` / `asset.created` 可订阅。签名 `X-CloudDeck-Signature`（HMAC-SHA256 + 时间戳），重试 5 次指数退避。

## OpenAPI

- 由 `packages/contracts` 生成 `openapi.yaml`，CI 校验与实现一致。
- 客户端 SDK（TS）由 OpenAPI 生成；移动端复用同一 SDK。
- 破坏性变更必须新增 `/v2`，并保留 `/v1` 至少 6 个月。
