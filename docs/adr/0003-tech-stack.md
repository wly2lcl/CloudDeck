# ADR-0003 技术栈

- 状态：已接受（D1 见 ADR-0007；D3 见 ADR-0008）
- 日期：2026-11-14

## 背景

后端语言可自由选择；需要兼顾第三方 agent 生态、媒体 worker、双端客户端与团队效率。

## 决策

| 层 | 选择 |
|---|---|
| 控制面 | TypeScript + Fastify |
| ORM/迁移 | Drizzle + Postgres |
| 队列 | Redis + BullMQ |
| 对象存储 | S3 兼容 |
| Web | Next.js App Router |
| 移动端 | Flutter（Dart） |
| 媒体 worker | Python（TTS）、Node/FFmpeg（视频） |
| 契约 | zod → TS 类型 + OpenAPI → 客户端 SDK |

## 理由

- driver 生态以 TS 为主：Claude Code SDK、OpenCode SDK、dsh SDK 均优先支持 TS；控制面用 TS 可减少胶水层。
- 契约与 Web 端同语言，schema 可直接复用；移动端经 OpenAPI 生成 Dart。
- 移动端选 Flutter：团队已有成熟 Flutter 产品经验（NovelPhone），媒体播放与多端一致性优先于 TS 类型复用。
- Python 只在真正需要的地方（TTS、音频处理）使用，避免全栈分裂。
- Fastify 而非 NestJS：控制面逻辑以显式流程为主，不需要 DI 与装饰器带来的隐式性。

## 后果

正面：
- 单一主语言，类型贯通
- 契约变更自动传播到双端
- worker 可按需多语言，通过队列解耦

代价：
- CPU 密集型逻辑（如大文件处理）不适合放在控制面，需下沉到 worker
- 移动端不能直接复用 TS 类型与组件，需维护「OpenAPI → Dart」「token → Dart」两条生成链，CI 必须防漂移
- 若团队 Go 更强，控制面换 Go 需重写契约生成链

## 替代方案

- **Go 控制面 + TS 前端**：部署简单、性能好，但 driver 与 SDK 胶水更多，契约需双份生成。
- **全 Python**：TTS 生态近，但 agent CLI 生态与前端共用类型能力弱。
- **Expo/RN 移动端**：契约与组件复用最好、单一 TS 技术栈，但团队 Flutter 经验与媒体 UI 一致性优先，故不选（见 ADR-0007）。
