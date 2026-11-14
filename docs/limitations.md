# 已知限制

本文件集中记录当前版本的能力边界与外部依赖，避免在 README 与 ADR 中分散查找。

## 模型与媒体

| 项 | 现状 | 解除条件 |
|---|---|---|
| 真实 LLM | 支持 OpenAI 兼容端点；无密钥时使用启发式生成 | 配置 `LLM_HTTP_URL` / `LLM_MODEL` / `LLM_HTTP_TOKEN` |
| 真实 TTS | 支持百炼 `qwen-audio-3.1-tts-flash`；无密钥时使用 fake WAV | 配置 `BAILIAN_API_KEY` |
| 视频 | 确定性 ffmpeg 合成（Ken Burns + 混音）；无生成式视频 | 选定视频模型并接入新 driver |
| 字幕 | 输出独立 SRT；当前 ffmpeg 构建无 libass，不做烧录 | 使用带 libass 的 ffmpeg 或引入字幕渲染步骤 |
| 音画同步 | 只在短视频上抽检，未做 3 分钟级基线 | 增加媒体回归样例与测量 |
| GPU | compose GPU profile 已提供，未做真实调度验证 | 提供 NVIDIA 节点并跑基准 |

## 沙箱与安全

| 项 | 现状 | 解除条件 |
|---|---|---|
| gVisor | `SANDBOX_RUNTIME=runsc` 代码就绪；本机未安装 | 安装 runsc 并跑 `pnpm sandbox:check` |
| 本地沙箱 | 仅进程隔离，不是安全边界 | 生产使用 Docker/gVisor |
| Docker 网络白名单 | 仅支持 `none` / `bridge` | 引入 egress 代理与域名白名单 |
| 多租户 RLS | 应用过滤 + RLS；runner 生产需 BYPASSRLS 角色 | 按部署文档配置角色 |
| 凭据轮换 | 支持 `CREDENTIALS_KEY_PREVIOUS` + rotate；非原子 | 可重跑失败项 |

## 商业化与客户端

| 项 | 现状 | 解除条件 |
|---|---|---|
| 支付 | mock/http provider；无真实资金流 | 商户号与支付网关 |
| 税务发票 | 只有可打印 HTML 账单 | 合规开票服务 |
| 移动端推送 | 服务端设备令牌与推送网关就绪；客户端未接 | Firebase/APNs 项目与证书 |
| 多语言 | 文档与 UI 以中文为主，README 中英双语 | 目标语言文案与本地化评审 |
| 实时协作 | 评论 SSE；无多人同时编辑 | CRDT/OT 方案 |
| 桌面端 | PWA/浏览器；无原生桌面 | 需求确认后评估 Tauri |

## 引擎

| 引擎 | 现状 |
|---|---|
| Claude Code | stream-json 适配与假 CLI 测试；真实 CLI 需 `ANTHROPIC_API_KEY` |
| OpenCode | 未安装、未验证；不交付未验证适配器 |
| dsh | 同 OpenCode |
| 自研流水线 | LLM/TTS/视频 worker 已实现 |

## 运维

- 无内置备份/告警/日志聚合；依赖部署环境。
- `/metrics` 为全局聚合，未按租户拆分。
- 未做容量基准（当前只有单机读接口 4k rps 基线）。
- 无负载均衡下的 SSE 粘性会话配置示例。

## 请求帮助

如果某项阻塞了你的使用场景，请开 issue 说明工作负载与外部条件，我们优先按实际需求解冻。
