# ADR-0011 M3 有声流水线：Provider 契约、断点与工作区保留

- 状态：已接受
- 日期：2026-11-14

## 背景

M3 需要把稿件变成有声书，涉及章节切分、角色识别、音色映射、分块合成、拼接与断点续作。真实 CosyVoice 需要 GPU，DashScope 需要密钥，二者都不能作为 CI 依赖；同时断点续作要求失败后工作区不能被清理。

## 决策

1. **Provider 契约**：`TtsProvider.synthesize({text, voice, format}) -> Buffer`。
   - `fake`：确定性 WAV，用于开发与测试。
   - `http`：向 `TTS_HTTP_URL` POST JSON，接受二进制或 `{audioBase64}`。CosyVoice 与 DashScope 网关都通过该契约接入，不硬编码未验证的云 API。
2. **流水线**：章节切分 → 旁白/对白识别 → 按角色映射音色 → 按字数切块 → 逐块合成 → 章节拼接 → 全书拼接。
3. **断点**：以块为最小单元写 `output/checkpoint.json`；每完成一块立即落盘，重复运行只补未完成块。
4. **工作区保留**：runner 使用 `<workspaceRoot>/clouddeck-job-<jobId>`；能力 `resumable: true` 且失败/取消时保留工作区，成功时删除。
5. **续作语义**：`POST /v1/jobs/:id/resume` 复用同一 jobId 与工作区，将状态改回 `queued` 并递增 `resume_count`；不创建新任务。
6. **音频拼接**：M3 的 fake provider 输出 WAV，直接按 RIFF 头拼接，不依赖 ffmpeg；非 WAV provider 后续接入 ffmpeg 步骤。
7. **预算**：每块上报 `usage`（字符数与成本），沿用 M1 的预算熔断。

## 后果

正面：
- 无 GPU、无密钥也能跑通完整链路与断点逻辑。
- 换真实 TTS 服务只改 provider 配置，不改流水线。
- 续作复用同一工作区，避免重复合成与重复计费。

代价：
- `fake` 音频只是占位，不能用于验收音质。
- 真实 provider 的响应契约需要按其服务实现一个薄适配器。
- 保留失败工作区会占用磁盘，需要后续加 TTL 清理。

## 回滚条件

- 若真实 TTS 服务返回非 WAV 格式，引入 ffmpeg 归一化步骤，而不是在 provider 里各自拼接。
- 若工作区占用失控，改为对象存储快照 + 恢复，而不是本地目录保留。
