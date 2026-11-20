# 第三阶段：生产化与可靠性

## 目标

把平台从「功能可用」推进到「可长期运行」：协作数据可恢复、供应链可审计、备份可自动执行、容量与告警有基线、网关与 driver 具备生产级边界。

## 检查清单

| 项 | 状态 | 说明 |
|---|---|---|
| Yjs 协作持久化 | ✅ | `collab_docs` 按租户/项目/文档保存 Yjs 状态，连接时恢复、更新后写回 |
| 协作草稿保存资产 | ✅ | Web 编辑器「保存为资产」创建 `novel_manuscript` 资产 |
| SBOM 与依赖审计 | ✅ | `pnpm sbom` 生成 CycloneDX 1.5，CI 归档 `sbom.json` |
| 备份自动化 | ✅（脚本） | `backup-docker.sh` / `restore-docker.sh`，支持 compose 容器与存储卷 |
| 媒体容量基线 | ✅（有声） | 5 个 audiobook 任务（伪 TTS）p50 411ms、p95 455ms、总耗时 30s；视频与真实 TTS 待补 |
| 可观测性面板 | ✅（模板） | `infra/observability/dashboard.json` 提供任务、5xx、用量面板 |
| K8s 校验 | ✅（基础） | `pnpm k8s:check` 校验 YAML 结构与必填字段，纳入 `pnpm check` |
| 网关 job token | ✅ | 创建任务时签发 30 分钟 token；runner 注入 `MODEL_GATEWAY_TOKEN`，LLM worker 走控制面网关 |

## 完成标准

- 每个「已完成」项有自动化测试或演练记录。
- 每个「待做」项有可执行脚本/工作流，不依赖人工记忆。

## 验证记录（2026-11-19）

- 10 万字伪 TTS 有声任务：30s 完成。
- 断点续作：注入第 30 块失败后重启 runner，恢复时跳过 29 块并成功。
- 全链路：剧本（模型失败回退启发式）→ 分镜 → 有声 → 视频，4 个任务全部成功。
- 网关 BYOK：租户凭据 `baseUrl/model` 单测覆盖；远程端点 429 时本地 `hy4-flash-free` 跑通真实模型全链路。
- 真实全链路：剧本/分镜使用真实模型（无回退），有声使用百炼 TTS，视频真实合成；视频 195KB。
- LLM 生成 JSON 的 max_tokens 提升到 8192，避免剧本 JSON 截断。
