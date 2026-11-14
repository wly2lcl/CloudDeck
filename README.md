# CloudDeck

面向创作者与内容团队的 AI 内容生产工作台，Web 与移动端同源。

核心主张两条：

1. **内容资产链**——小说、剧本、有声、视频不是四个独立工具，而是同一条内容链上的四道工序，共享项目、角色、设定与版本。
2. **能力可插拔**——每个能力（capability）只声明契约，执行引擎（Claude Code、OpenCode、dsh、自研流水线）全部是适配器，可替换、可灰度、可降级。

平台自身不实现 agent，也不复用任何引擎的内部代码。平台只做编排、资产、任务、权限与计费。

## 当前状态

M0 骨架（2026-11-14）：契约包、控制面健康检查与错误信封、Web 占位页、本地 compose、CI 与依赖边界规则已落地。业务功能尚未开始。

## 快速开始

环境：Node >= 22、pnpm 10；Docker 可选，用于本地依赖。

```sh
pnpm install
pnpm dev        # 控制面 :4310 + Web :3000
```

本地依赖（Postgres / Redis / MinIO）：

```sh
cd infra/compose && cp .env.example .env && docker compose up -d
```

常用命令：

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 并行启动控制面与 Web |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm test` | 单元/契约测试 + 边界自测 |
| `pnpm boundaries` | 依赖边界扫描 |
| `pnpm check` | 以上全部 |

## 文档索引

| 文档 | 内容 |
|---|---|
| [00 产品定义](docs/00-product.md) | 定位、用户、范围、非目标、成功指标、术语 |
| [01 架构](docs/01-architecture.md) | 分层、四层契约、运行时拓扑、job 生命周期 |
| [02 契约](docs/02-contracts.md) | CapabilityManifest、Driver、JobEvent、AssetRef、状态机 |
| [03 数据模型](docs/03-data-model.md) | 多租户表结构、资产链、计量账本 |
| [04 能力设计](docs/04-capabilities.md) | 五个能力的 manifest、步骤图、验收口径 |
| [05 引擎适配](docs/05-drivers.md) | Claude Code / OpenCode / dsh / 自研流水线 |
| [06 API](docs/06-api.md) | REST、SSE、错误码、幂等、限流 |
| [07 客户端](docs/07-clients.md) | Web、移动端、schema 驱动 UI |
| [08 安全与计费](docs/08-security-billing.md) | 沙箱、密钥、权限、配额、计费、合规 |
| [09 仓库与规范](docs/09-repo-conventions.md) | monorepo、边界规则、CI 门禁、测试策略 |
| [10 路线图](docs/10-roadmap.md) | M0–M5 里程碑与退出标准 |
| [11 开发计划](docs/11-dev-plan.md) | 迭代任务、验收标准、工期 |
| [12 风险与待决策](docs/12-risks.md) | 风险登记、触发信号、待确认事项 |

架构决策记录见 [docs/adr/](docs/adr/)。

## 文档约定

- 契约（schema、接口、状态机）是唯一事实源；实现与文档冲突时以契约为准，改契约必须走版本变更。
- 每个能力必须有可自动化的验收口径，不做「看起来能用」的验收。
- 未决事项统一记入 [12 风险与待决策](docs/12-risks.md)，不在正文里含糊带过。
