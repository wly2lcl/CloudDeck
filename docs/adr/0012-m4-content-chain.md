# ADR-0012 M4 内容链：剧本、分镜、视频与 Webhook

- 状态：已接受
- 日期：2026-11-14

## 背景

M4 要把内容链从文字延伸到成片，同时提供可观测的派生关系与事件通知。约束：CI 无模型密钥、视频依赖 ffmpeg、生成式视频不可控。

## 决策

1. **LLM provider 双路径**
   - 未配置模型服务时使用确定性启发式（章节 → 幕/场、剧本 → 分镜），保证无密钥可跑通。
   - 配置 `LLM_HTTP_URL` / `LLM_MODEL` 时走 OpenAI 兼容的 `chat/completions`，要求返回 JSON。
   - 不硬编码任何厂商私有接口。

2. **链路契约**
   - `script.generate` 输出 Markdown 剧本，场景标题固定为 `### 第 N 场 标题`，供分镜解析。
   - `storyboard.plan` 输出 JSON：`{title, shots:[{index, scene, description, shotSize, camera, durationMs}]}`。
   - `video.render` 消费该 JSON，输出 MP4、SRT 与首帧。

3. **视频合成**
   - 确定性路线：逐镜生成 BMP 画面 → ffmpeg `zoompan` 缓推 → 拼接 → 混入可选配音。
   - 字幕输出为独立 SRT；当前 ffmpeg 构建无 libass，不做烧录。
   - 不引入生成式视频，后续作为「单镜头渲染 driver」替换画面来源。

4. **内容链 API 与 UI**
   - `GET /v1/projects/:id/graph` 返回资产节点与派生边。
   - Web 按资产类型分列布局，点击节点复用资产预览；不引入图库。

5. **Webhook**
   - 租户级 `webhooks` + `webhook_deliveries` 两张表，事件过滤用 JSONB 包含判断。
   - 签名：`HMAC-SHA256(secret, timestamp + "." + body)`，Header 带事件、时间戳与签名。
   - M4 在 runner 终态同步投递，最多 3 次；后续改为队列异步。

6. **gVisor**
   - M4 不启用。依据：当前第三方 agent 仅 `novel.edit`，Docker 只读根 + 非 root + 无网络已满足内测；`coding.assist` 上线前再评估 gVisor/Firecracker。
   - 触发条件：开放代码执行能力、对外多租户、出现沙箱逃逸告警。

## 后果

正面：
- 无模型密钥也能验证整条内容链。
- 剧本/分镜格式稳定，便于替换生成方式。
- Webhook 有投递记录，可审计与重放（后续）。

代价：
- 启发式生成质量有限，仅用于开发与兜底。
- ffmpeg 是硬依赖，Docker 沙箱镜像必须内置。
- 同步投递会占住 runner，事件多时需要异步化。

## 回滚条件

- 若真实模型输出无法稳定满足 JSON 结构，增加一次修复重试或改为结构化输出 SDK。
- 若视频镜头数增长导致渲染超时，改为并行渲染 + 片段缓存。
- 若 Webhook 量大，迁移到 outbox worker。
