# 09 仓库与规范

## monorepo 结构

```text
CloudDeck/
  apps/
    web/                    # Next.js
    mobile/                 # Flutter（Dart）
  services/
    control-plane/          # Fastify API
    job-runner/             # 队列消费 + 沙箱 + driver 生命周期
  packages/
    contracts/              # 四层契约：zod schema、类型、OpenAPI 生成
    db/                     # Drizzle schema 与迁移
    capability-sdk/         # 写能力用的运行时（workflow 执行、事件上报）
    ui/                     # 共享组件、tokens、schema 表单、资产渲染器
    sdk/                    # 由 OpenAPI 生成的客户端 SDK
  drivers/
    claude-code/
    opencode/
    dsh-acp/
    llm/
  capabilities/
    novel-edit/
    script-generate/
    audiobook-render/
    storyboard-plan/
    video-render/
  workers/
    tts/                    # Python
    audio-post/             # Python/FFmpeg
    video/                  # Node/FFmpeg
  infra/
    compose/
    k8s/
    scripts/
  docs/
```

## 技术栈

| 层 | 选择 | 理由 |
|---|---|---|
| 控制面 | TypeScript + Fastify | driver 生态全是 TS；无需框架魔法 |
| ORM/迁移 | Drizzle | SQL 可控、类型安全、迁移可审阅 |
| 数据库 | Postgres 16 | RLS、JSONB、分区、递归 CTE |
| 队列 | Redis + BullMQ | 起步简单；runner 可水平扩 |
| 对象存储 | S3 兼容（本地 MinIO） | 预签名直传 |
| Web | Next.js App Router | SSR + 流式 UI |
| 移动端 | Flutter | 团队已有经验；媒体播放与多端一致性优先；契约经 OpenAPI 生成 Dart |
| 媒体 worker | Python / Node | 复用现有 NovelAudio、FFmpeg |
| 可观测 | OpenTelemetry + 结构化日志 | 跨服务追踪 |
| 测试 | Vitest + Playwright + Pytest | 单元/端到端/worker |

## 依赖边界（由 lint + 测试守护）

| 规则 | 说明 |
|---|---|
| `services/control-plane` 不得引用 `drivers/*`、`workers/*`、`capabilities/*` | 平台不认识引擎与能力实现 |
| `services/job-runner` 只依赖 `contracts` + driver 注册表接口 | 不直接 import 具体 driver |
| `capabilities/*` 之间禁止相互引用 | 只能通过资产引用 |
| `packages/contracts` 不得依赖任何业务包 | 契约是叶子 |
| `apps/*` 不得包含能力专属逻辑 | 只能靠 manifest + schema |
| driver 不得访问数据库/对象存储 | 只读写 workspace |

实现方式：
- ESLint `no-restricted-imports` + `eslint-plugin-boundaries`。
- CI 增加 `scripts/check-boundaries.ts`，扫描 import 图，失败即阻断。
- 与 basework 的 `arch_test.go` 同思路：规则写成可执行的测试，不写成文档口号。

## CI 门禁

流水线顺序：

1. `lint`：ESLint、Prettier、Go/Python 各自 linter
2. `typecheck`
3. `unit`：contracts、control-plane、capability-sdk
4. `boundaries`：依赖边界扫描
5. `contract`：manifest 校验、OpenAPI 一致性、driver 契约测试
6. `integration`：compose 起依赖，跑 job 全链路（mock driver）
7. `e2e`：Playwright 跑 Web 主流程
8. `security`：依赖审计、密钥扫描、镜像扫描

合并要求：全部通过 + 至少一次 review。主分支保护，不允许直推。

## 分支与提交

- 分支：`feat/<scope>-<short>`、`fix/...`、`docs/...`、`chore/...`
- 提交：Conventional Commits；scope 用模块名（`contracts`、`runner`、`capability:audiobook`）。
- 变更契约或数据库迁移必须在 PR 描述里写影响面与回滚方式。
- 迁移只前进不回滚；紧急回滚用补偿迁移。

## 测试策略

| 层 | 范围 | 要求 |
|---|---|---|
| 单元 | 状态机、schema、路由、计费 | 关键分支覆盖；状态机需穷举非法流转 |
| 契约 | manifest、driver、OpenAPI | 每个能力、每个 driver 必跑 |
| 集成 | 提交 → 队列 → runner → mock driver → 产物 | 每次 PR |
| 端到端 | Web 主流程 + 移动端关键路径 | 每日 + 发布前 |
| 性能 | 1000 并发 job 排队、SSE 1000 连接 | 里程碑前 |

测试数据：固定夹具放 `test/fixtures`，禁止依赖真实外部模型；真实模型回归单独 nightly。

## 文档规范

- 所有设计变更先改文档再改代码；文档与实现不一致视为缺陷。
- 每个能力包必须有 README，写清输入输出、失败分类、验收口径。
- ADR 只记录「有争议且影响面大」的决策，一事一档，不写流水账。

## 发布

- 版本：按组件独立版本，契约包 semver 最严格。
- 环境：local → staging → prod；staging 使用与 prod 同构的 compose/k8s。
- 灰度：按租户白名单 → 10% → 全量；能力与 driver 分别灰度。
- 回滚：应用镜像回滚；数据库只补偿；能力可单独 disable。
