# 第三阶段：生产化与可靠性

## 目标

把平台从「功能可用」推进到「可长期运行」：协作数据可恢复、供应链可审计、备份可自动执行、容量与告警有基线、网关与 driver 具备生产级边界。

## 检查清单

| 项 | 状态 | 说明 |
|---|---|---|
| Yjs 协作持久化 | 已完成 | `collab_docs` 按租户/项目/文档保存 Yjs 状态，连接时恢复、更新后写回 |
| 协作草稿保存资产 | 已完成 | Web 编辑器「保存为资产」创建 `novel_manuscript` 资产 |
| SBOM 与依赖审计 | 已完成 | `pnpm sbom` 生成 CycloneDX 1.5，CI 归档 `sbom.json` |
| 备份自动化 | 已完成（脚本） | `backup-docker.sh` / `restore-docker.sh`，支持 compose 容器与存储卷 |
| 媒体容量基线 | 待做 | 有声/视频并发任务压测与资源画像 |
| 可观测性面板 | 已完成（模板） | `infra/observability/dashboard.json` 提供任务、5xx、用量面板 |
| K8s 校验 | 已完成（基础） | `pnpm k8s:check` 校验 YAML 结构与必填字段，纳入 `pnpm check` |
| 网关 job token | 已完成（接口） | `POST /v1/jobs/:id/gateway-token` 签发 5 分钟 token；driver 自动接入待做 |

## 完成标准

- 每个「已完成」项有自动化测试或演练记录。
- 每个「待做」项有可执行脚本/工作流，不依赖人工记忆。
