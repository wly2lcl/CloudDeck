# 架构决策记录

| 编号 | 决策 | 状态 |
|---|---|---|
| [0001](0001-four-layer-contracts.md) | 以四层契约作为系统边界 | 已接受 |
| [0002](0002-driver-process-isolation.md) | 引擎一律进程/容器隔离 | 已接受 |
| [0003](0003-tech-stack.md) | 技术栈（TS/Fastify/Postgres/Next/Flutter） | 已接受，D3 待确认 |
| [0004](0004-asset-model-content-chain.md) | 资产不可变 + 内容链 | 已接受 |
| [0005](0005-multi-tenancy-billing.md) | 单库多租户 + 预扣结算 | 已接受，D5 待确认 |
| [0006](0006-third-party-agent-compliance.md) | 第三方 agent 接入与合规 | 已接受（首发仅 BYOK） |
| [0007](0007-mobile-flutter.md) | 移动端选用 Flutter | 已接受 |
| [0008](0008-commercial-phasing.md) | 商业化与部署分阶段（A → B → C） | 已接受 |
| [0009](0009-m1-queue-and-events.md) | M1 使用 Postgres 队列与轮询事件流 | 已接受（M1 临时） |
| [0010](0010-m2-sandbox-and-agent-driver.md) | M2 沙箱抽象与 agent driver 接入 | 已接受 |

约定：ADR 只记录有争议且影响面大的决策；决策变更时新增编号并标注取代关系，不修改历史记录。
