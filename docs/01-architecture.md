# 01 架构

## 总原则

1. 平台不认识任何具体引擎。Claude Code、OpenCode、dsh、自研 worker 地位完全相同。
2. 能力之间只通过资产引用和事件通信，禁止直接 RPC 调用。
3. 契约先行：manifest、driver、event、asset 四层契约版本化。
4. 进程隔离优先于进程内集成：引擎一律独立进程/容器，通过 stdio/HTTP/队列交互。
5. 先单体后拆分：控制面与 runner 可同仓部署，按负载再拆。

## 分层

```text
┌──────────────────────────────────────────────────────────────┐
│ 客户端  Web (Next.js)          移动端 (Flutter)               │
│          只依赖：能力列表 + JSON Schema + 资产类型            │
└───────────────────────────┬──────────────────────────────────┘
                            │ REST + SSE（同一套 API）
┌───────────────────────────▼──────────────────────────────────┐
│ 控制面 control-plane                                          │
│  账号/租户 · 能力注册表 · 项目/资产 · job 编排 · 配额计费 · 审计 │
│  只认识 manifest 与 job，不认识引擎                            │
└──────────┬───────────────────────────────┬───────────────────┘
           │ 队列（BullMQ/Redis）           │ 对象存储（S3）
┌──────────▼───────────────────────────────▼───────────────────┐
│ 执行面 job-runner                                             │
│  拉任务 → 起沙箱容器 → 启 driver 进程 → 转发事件 → 收集产物    │
└──────────┬───────────────────────────────────────────────────┘
           │ Driver 协议（stdio JSON-RPC / HTTP / ACP / 子进程）
┌──────────▼───────────────────────────────────────────────────┐
│ 引擎 drivers                                                  │
│  claude-code · opencode · dsh-acp · llm-pipeline · tts · video │
└──────────────────────────────────────────────────────────────┘
```

## 四层契约

| 契约 | 定义位置 | 变更影响 |
|---|---|---|
| **CapabilityManifest** | `packages/contracts/src/capability.ts` | 能力包、客户端表单 |
| **Driver 协议** | `packages/contracts/src/driver.ts` | 所有引擎适配器 |
| **JobEvent** | `packages/contracts/src/events.ts` | runner、API、客户端 |
| **AssetRef / AssetType** | `packages/contracts/src/asset.ts` | 跨能力数据流 |

详细定义见 [02 契约](02-contracts.md)。

## 运行时组件

| 组件 | 职责 | 首版实现 |
|---|---|---|
| `control-plane` | HTTP API、鉴权、注册表、资产元数据、job 状态机、计费 | TS + Fastify + Postgres |
| `job-runner` | 消费队列、管理沙箱生命周期、运行 driver、上报事件 | TS（Node） |
| `sandbox` | 每 job 一个容器，挂载工作区，限制网络与资源 | Docker |
| `workers/*` | 具体流水线执行体（TTS、视频、分镜） | Python / Node |
| `drivers/*` | 引擎适配器 | Node / Python |
| `web` | Web 客户端 | Next.js App Router |
| `mobile` | 移动客户端 | Flutter |
| `infra` | compose / k8s / 迁移脚本 | — |

## 一次 job 的生命周期

1. 客户端 `POST /v1/projects/:id/jobs`，带 capabilityId、输入资产、参数。
2. 控制面校验：能力存在、输入类型匹配、配额足够、manifest 权限允许。
3. 落库为 `queued`，写入队列；返回 `jobId`。
4. runner 取任务，置 `provisioning`：创建沙箱、下载输入资产到 workspace、注入限额与密钥。
5. runner 启动 driver，置 `running`；driver 事件经 runner 标准化为 `JobEvent` 写库并发布。
6. 客户端通过 `GET /v1/jobs/:id/events`（SSE）或 WebSocket 订阅。
7. driver 结束：产物上传对象存储，控制面写 `asset` + `asset_version` + `asset_link`，job 置 `succeeded`。
8. 失败或超预算：置 `failed` / `cancelled`，保留日志与部分产物，可重试或续作。
9. 沙箱销毁，用量写入 `usage_ledger`。

## 部署形态

**本地/单机（M0–M3）**
docker-compose：postgres、redis、minio、control-plane、runner、web。GPU worker 可选 profile。

**云端（M4+）**
- control-plane：无状态，多副本 + 负载均衡
- runner：按队列深度水平扩容
- 沙箱：K8s Job 或独立节点池；GPU 任务走专用节点池与标签调度
- 存储：S3 兼容对象存储 + CDN
- 队列：Redis 起步，量级上来换 Kafka/Redis Streams

## 关键边界

- 控制面**禁止** import `drivers/*`、`workers/*`、任何引擎 SDK。
- runner 只依赖 `packages/contracts`，不依赖具体 driver 实现（通过注册表按 id 加载）。
- 能力包**禁止** import 其他能力包。
- 客户端**禁止**包含任何能力专属业务逻辑，只能靠 manifest + schema 渲染。

这些边界由 lint 规则和依赖测试守护，见 [09 仓库与规范](09-repo-conventions.md)。
