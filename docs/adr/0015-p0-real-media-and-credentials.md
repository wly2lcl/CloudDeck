# ADR-0015 P0 收口：真实 TTS、租户凭据加密与真实 Postgres 验证

- 状态：已接受
- 日期：2026-11-14

## 背景

第一阶段剩余的三个 P0 缺口：

1. TTS 只有 fake/http 契约，未接真实服务；
2. 模型密钥仅从 runner 进程环境注入，租户 BYOK 没有加密存储；
3. 所有集成测试跑在 PGlite，真实 Postgres + Docker 部署路径未验证。

## 决策

1. **接入阿里云百炼 TTS**
   - 端点：`POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`
   - 模型：`qwen-audio-3.1-tts-flash`，默认音色 `longanhuan_v3.1`
   - 请求体：`{model, input:{text, voice, format:'wav', sample_rate:24000}}`
   - 响应：`output.audio.url` 下载，或 `output.audio.data` base64
   - 占位音色（`narrator` / `default` / `旁白` / `对白`）自动回落到 `TTS_DEFAULT_VOICE`
   - 复用 429/5xx 指数退避与 `Retry-After`
   - 入口：`TTS_PROVIDER=dashscope` + `BAILIAN_API_KEY` 或 `DASHSCOPE_API_KEY`

2. **租户模型凭据加密**
   - `model_credentials` 表保存 `AES-256-GCM` 密文与末四位提示。
   - 主密钥来自 `CREDENTIALS_KEY`；未设置时回退 `AUTH_SECRET`（仅开发）。
   - 明文不返回、不写日志；API 只返回 `keyHint`。
   - runner 解析顺序：进程环境优先，缺失时按 provider 映射解密租户凭据注入。
   - provider 映射：`anthropic → ANTHROPIC_API_KEY`，`dashscope/bailian → DASHSCOPE_API_KEY / BAILIAN_API_KEY`，`openai/openrouter → OPENAI_API_KEY / LLM_HTTP_TOKEN`。

3. **真实部署验证**
   - 使用 `infra/compose` 启动 Postgres 16，控制面与 runner 分别进程启动。
   - 验证后执行 `docker compose down -v`、删除临时存储/工作区、停止进程。

## 证据（2026-11-14）

TTS provider 冒烟：

- 810ms 返回 `149804` 字节 WAV，24kHz，时长 3120ms。

真实全链路（Postgres + runner 环境已移除 `BAILIAN_API_KEY` / `DASHSCOPE_API_KEY`）：

- 通过 API 创建 `dashscope` 租户凭据，`verify` 解密成功，列表仅显示 `****zMv5`。
- `script.generate`：真实 LLM 生成剧本（约 17s）。
- `storyboard.plan`：真实 LLM 生成分镜。
- `audiobook.render`：真实百炼 TTS 生成 3 个 `audio_track`（2 章 + 合并版），合并音频 16.0s / 768KB。
- `video.render`：h264 + aac，16.56s / 193KB。
- 月度对账单：4 个任务，3 条能力明细，总额 `$0.0038`。

清理：

- Postgres 容器、`pgdata` 卷、compose 网络均已删除；`/tmp/clouddeck-e2e` 已移除；4320 端口无残留监听。

## 后果

正面：
- 有声链路不再是占位音频，真实可听。
- 租户 BYOK 可用，密钥不落明文，runner 可按租户注入。
- 真实 Postgres 的迁移、RLS、队列、runner、存储路径均已跑通。

代价：
- 百炼 TTS 的计费按字符/Token，平台当前按能力估算记费，可能与实际账单有偏差。
- 主密钥轮换、凭据使用审计与 last_used_at 更新尚未实现。
- Docker 沙箱与网络白名单仍未在真实 agent 场景验证。

## 回滚/后续

- 主密钥轮换需要“解密-重加密”迁移脚本，不能用新密钥直接覆盖。
- 若切换 TTS 供应商，新增 provider 并保持 `TtsProvider` 契约不变。
- 计费与实际账单对齐需要接入 provider 的 usage 字段。
