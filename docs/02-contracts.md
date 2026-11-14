# 02 契约

本文件是所有模块的共同事实源。代码实现与此冲突时，以实现为准并修正本文件；修改契约必须提版本。

## 版本策略

| 层级 | 版本字段 | 破坏性变更 |
|---|---|---|
| 契约包 `@clouddeck/contracts` | semver | major 升级，附迁移说明 |
| 能力 manifest | `version`（能力自身） | 新增字段次版本；改输入输出 major |
| driver 协议 | `protocolVersion` | 只增不改；不兼容升版本 |
| 对外 API | `/v1` | 新版本路径并存至少 6 个月 |

## 1. CapabilityManifest

每个能力一个目录，入口 `capability.yaml`：

```yaml
id: audiobook.render
version: 1.2.0
name: 有声小说生成
description: 将稿件按章节合成为多角色有声书
category: audio            # writing | script | audio | video | coding
icon: audio-book

inputs:
  - name: manuscript
    label: 稿件
    assetTypes: [novel_manuscript, script]
    required: true
  - name: voiceMap
    label: 角色音色映射
    assetTypes: [voice_profile]
    required: false

outputs:
  - name: audio
    assetType: audio_track
    multiple: true

execution:
  mode: async              # sync | async
  resumable: true
  maxDurationMs: 21600000  # 6h
  maxCostUsd: 5
  concurrency: 4           # 同一 job 内允许的并行步骤数

credentials:
  policy: tenant           # tenant | platform | either；首发默认 tenant

driver:
  kind: pipeline           # agent-cli | acp | pipeline | llm
  ref: workers/tts
  routing:
    - when: { tenantTier: pro, gpu: true }
      driver: tts-local
    - driver: tts-cloud

permissions:
  network: [dashscope.aliyuncs.com]
  filesystem: workspace-only
  secrets: [DASHSCOPE_API_KEY]
  allowShell: false

resources:
  cpu: 2
  memory: 4Gi
  gpu: optional

billing:
  unit: per_1k_chars
  priceKey: audiobook_tts
  estimate: 0.002          # 每千字美元，用于预扣

ui:
  form: ui/form.json       # JSON Schema 扩展 + 字段顺序/分组
  result: audio_player     # 客户端内置渲染器 id
  preview: ui/preview.md

tags: [有声, 批量]
```

字段约束：

- `id` 全局唯一，格式 `<domain>.<action>`，小写点分。
- `inputs`/`outputs` 的 `assetTypes` 必须是 `AssetType` 枚举成员。
- `execution.maxCostUsd` 必须有；`estimate` 用于预扣，实际以 `usage_ledger` 结算。
- `permissions.network` 为空数组表示禁止出网；`allowShell` 默认 false。
- `credentials.policy`：`tenant` 仅允许租户自有密钥；`platform` 仅允许平台池；`either` 按租户配置回落。首发全部默认 `tenant`。
- `billing.estimate` 与 `credentials.policy` 共同决定提交时的预扣与拒绝策略。
- `driver.routing` 自上而下匹配，必须有 `default`。
- 能力包不得声明平台未支持的字段（lint 报错）。

## 2. Driver 协议

driver 是独立进程或服务，由 runner 启动与监督。

```ts
export interface Driver {
  readonly id: string
  readonly protocolVersion: 1

  /** 提交任务。返回后 runner 开始消费 events。 */
  submit(ctx: TaskContext): Promise<{ externalId?: string }>

  /** 事件流：驱动结束必须 yield 且仅 yield 一次 done 或 error。 */
  events(ctx: TaskContext): AsyncIterable<JobEvent>

  /** 取消：应幂等，并在 30s 内结束事件流。 */
  cancel(ctx: TaskContext): Promise<void>

  /** 收集产物：driver 负责把产物放到 ctx.outputDir 并返回元数据。 */
  collect(ctx: TaskContext): Promise<ArtifactSpec[]>
}

export interface TaskContext {
  jobId: string
  tenantId: string
  capability: {
    id: string
    version: string
    outputs?: OutputSpec[]              // 驱动据此决定产物类型
    systemPrompt?: string               // 来自能力包 prompts.system
  }
  params: Record<string, unknown>       // 已按 form schema 校验
  inputs: LocalAsset[]                  // 已下载到 workspace 的本地文件
  workspace: string                     // 可读写，job 结束销毁
  outputDir: string                     // 仅此处产物会被收集
  env: Record<string, string>           // 注入的密钥与非敏感配置
  limits: {
    maxDurationMs: number
    maxCostUsd: number
    maxOutputBytes: number
  }
  signal: AbortSignal
  commands: CommandRunner               // 沙箱注入的命令执行器
}

export interface LocalAsset {
  assetId: string
  version: number
  type: AssetType
  path: string
  mime: string
}

export interface ArtifactSpec {
  name: string
  type: AssetType
  path: string
  mime: string
  meta?: Record<string, unknown>
}
```

命令执行器（runner 注入，driver 不直接 spawn）：

```ts
export interface CommandRunner {
  run(command: string, args: string[], options: CommandOptions): Promise<CommandResult>
  runStream?(command: string, args: string[], options: CommandOptions,
             onStdout: (chunk: string) => void): Promise<CommandResult>
}
```

约定：

- driver 不直接访问数据库、对象存储或控制面 API；只读写 workspace 与输出目录。
- 需要调用模型时，driver 使用 runner 下发的网关地址与短期 token（见 08），不得内置长期密钥。
- driver 的 stdout/stderr 只写日志；结构化事件走协议通道。
- driver 必须上报 `usage`，否则按 manifest 估值计费。

## 3. JobEvent

```ts
export type JobEvent =
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; at: string }
  | { type: 'progress'; percent: number; message?: string; at: string }
  | { type: 'partial'; name: string; assetType: AssetType; path: string; index?: number; at: string }
  | { type: 'artifact'; spec: ArtifactSpec; at: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; chars?: number; costUsd: number; at: string }
  | { type: 'error'; code: string; message: string; retryable: boolean; at: string }
  | { type: 'done'; at: string }
```

规则：

- `progress.percent` 单调不减，0–100。
- `partial` 用于流式预览（如逐章音频），不进入资产库，除非后续 `artifact` 再次声明。
- `usage` 可多次上报，控制面累加；累计超 `maxCostUsd` 时 runner 触发取消。
- 事件按 `seq`（由 runner 生成）严格递增，客户端可断线重连后从 `Last-Event-ID` 续传。

## 4. AssetRef 与资产类型

```ts
export type AssetType =
  | 'novel_manuscript' | 'story_bible' | 'character_card'
  | 'script' | 'storyboard' | 'shot_list'
  | 'voice_profile' | 'audio_track' | 'music_bed'
  | 'image' | 'video_timeline' | 'video'
  | 'code_workspace' | 'patch' | 'document' | 'dataset'

export interface AssetRef {
  assetId: string
  version: number
  type: AssetType
  name: string
  mime: string
  size: number
  checksum: string
  derivedFrom?: { assetId: string; version: number }[]
  meta?: Record<string, unknown>
}
```

资产是不可变的：内容变化即新版本。派生关系写入 `asset_links`，构成内容链（见 [03 数据模型](03-data-model.md)）。

## 5. Job 状态机

```text
queued → provisioning → running → finalizing → succeeded
   │           │            │           │
   ├───────────┴────────────┴───────────┴──→ failed
   └──────────────→ cancelled（任意阶段，30s 内收敛）
```

- 终态：`succeeded` / `failed` / `cancelled`。
- `failed` 带 `errorCode` 与 `retryable`；可重试任务生成新 job 并记录 `retriedFromJobId`。
- 续作（`resumable: true`）沿用同一 `jobId`，事件流继续，新增 `resumeCount`。
- 任何状态变更写 `job_events`，作为唯一事实。

## 6. SSE 帧

```text
id: 1042
event: job.event
data: {"seq":1042,"type":"progress","percent":37,"at":"2026-11-14T09:12:03Z"}
```

- 心跳：每 15s 一条 `event: ping`。
- 断线重连：客户端带 `Last-Event-ID`，服务端补发缺失事件。
- 终态后服务端发送 `event: job.end`，客户端关闭连接。

## 7. 校验与兼容

- manifest 在构建期与加载期各校验一次（`@clouddeck/contracts` 导出 zod schema）。
- driver 启动时握手 `protocolVersion`，不匹配直接拒绝。
- 能力版本升级：输入输出不变 → 次版本；变更 → major，旧版本保留至少 30 天供在途 job 使用。
- 所有对外 JSON 使用 camelCase；数据库使用 snake_case。
