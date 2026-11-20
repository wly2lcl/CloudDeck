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

## 真实 TTS 长篇结论（2026-11-20）

- 2 万字真实百炼 TTS：176s 成功，流式拼接通过。
- 10 万字真实 TTS：首次并发 16 触发 `Throttling.RateQuota`；降到并发 4、6 次重试后，最终因 `AllocationQuota.FreeTierOnly`（免费额度耗尽）停止。
- 10 万字伪 TTS：30s 成功；断点恢复跳过 29 块。
- 已修复：相邻短句合并（4240→530 块）、WAV 流式拼接（避免 1.3GB 内存 OOM）、TTS 重试参数可配。
- 10 万字真实 TTS 需百炼付费额度或关闭 free-tier-only 后重跑；代码侧分块/流式拼接/重试已就绪。

## tts-next 验证（2026-11-20）

- 模型：`qwen-audio-3.1-tts-next`
- 1 万字、1000 字分块、并发 2：**28 块 / 1192s / 85MB WAV**，响度归一 -16 LUFS，状态 succeeded。
- 估算 token：约 160k（按 200 字 3190 token 推算），1M 免费额度约支撑 6–7 万字。
- 10 万字真实 TTS 仍需付费额度；代码路径已验证。

## coding.assist 真实验证（2026-11-20）

- runner 镜像内置 Claude Code CLI 2.1.325，驱动补 `--verbose` 适配 stream-json。
- 通过平台任务提交 `coding.assist`：36s succeeded，输出修复补丁（`return a - b` → `return a + b`）。
- 容器内 API key 不可用，验证使用宿主机 runner + 宿主机 Claude 登录态；生产需有效 `ANTHROPIC_API_KEY`。
