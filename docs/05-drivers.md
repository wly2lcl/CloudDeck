# 05 引擎适配

driver 是平台与引擎之间唯一的耦合点。平台只依赖 [Driver 协议](02-contracts.md#2-driver-协议)，不依赖任何引擎的库或内部实现。

## driver 分类

| kind | 形态 | 适用 | 实现语言 |
|---|---|---|---|
| `agent-cli` | 子进程 + stdio/JSON 流 | Claude Code、OpenCode CLI、Codex 等 | Node |
| `acp` | ACP JSON-RPC stdio | dsh、支持 ACP 的 agent | Node / Python |
| `pipeline` | 自研 worker + 队列 | TTS、视频、FFmpeg、ComfyUI | Python / Node |
| `llm` | 直接调模型网关 | 单步生成、分镜、剧本 | Node |

可以混用：一个能力的 workflow 里，可以同时有 `llm` 步骤和 `pipeline` 步骤。

## 5.1 Claude Code driver

**已验证的自动化入口**（本机 2.1.325）：

```sh
claude -p \
  --output-format stream-json --include-partial-messages \
  --input-format stream-json \
  --session-id "$SESSION_ID" \
  --permission-mode acceptEdits \
  --add-dir "$WORKSPACE" \
  --settings "$SETTINGS_JSON" \
  --mcp-config "$MCP_JSON" \
  --json-schema "$RESULT_SCHEMA"
```

要点：

- `-p` 非交互；`stream-json` 逐事件输出，adapter 负责映射为 `JobEvent`。
- `--session-id` 固定 UUID，配合 `--resume` 实现多轮；平台侧 job 与 session 一一对应。
- `--add-dir` 只给工作区，不给宿主其他目录。
- `--settings` 注入每能力配置；`--agents` 注入各能力专属 agent 定义；两者都不落宿主全局配置。
- `--json-schema` 拿结构化结果，避免解析自由文本。
- 沙箱内使用 `--dangerously-skip-permissions` 仅在「无网络 + 只挂载工作区 + 非 root」三项同时满足时允许；否则必须走预置权限模式。
- 不依赖交互式 UI，不解析 ANSI 输出。

**适配层职责**：

1. 生成 settings / MCP / schema 临时文件。
2. 启动子进程，按行解析 stream-json，映射事件。
3. 监听超时、预算与取消信号，先 SIGTERM 后 SIGKILL 进程树。
4. 收集 workspace 内声明的产物，调用 `collect`。
5. 上报 token usage 与估算成本。

**风险**：CLI 版本变动、输出事件结构变动、商用与托管条款（见 12 待决策）。缓解：版本固定 + 事件映射契约测试 + 每版本回归样例。

### M2 实现

- 实际命令：`claude -p --output-format stream-json --include-partial-messages --add-dir <workspace> --permission-mode acceptEdits`，可选 `--model`、`--session-id`。
- 提示词通过 stdin 传入；能力包 `prompts.system` 由 runner 读取并注入，输入文件仅给出路径，由 agent 自行读取。
- 事件映射：

| CLI 事件 | 平台事件 |
|---|---|
| `system` | `log`（debug） |
| `assistant.text` | `log`（info，截断） |
| `assistant.tool_use` | `log`（info，工具名） |
| `result` success | `usage`（cost/tokens） |
| `result` 非 success | `error`（`AGENT_FAILED`） |
| 进程非零退出 | `error`（`DRIVER_ERROR`） |
| 缺少 `output/result.md` | `error`（`NO_ARTIFACT`） |

- 产物约定：agent 必须写 `output/result.md`，驱动按 manifest 首个 output 声明资产类型。
- 取消：runner 通过 `AbortSignal` 让沙箱终止整个进程组。
- 测试：`test/fixtures/fake-claude.mjs` 覆盖成功、失败、取消、缺产物；真实 CLI 冒烟需要 `ANTHROPIC_API_KEY`，不进入 CI。
- OpenCode：本机未安装，server/run 接口未验证，M2 不交付未经验证的适配器，M3 再接入。

## 5.2 OpenCode driver

- 优先使用常驻 server 模式（一个沙箱一个进程），通过 HTTP + 事件流驱动，避免每 job 冷启动。
- 若不支持 server 模式或版本不匹配，退回非交互 `run` 子进程。
- 具体子命令与事件格式在 M2 做 spike 后写死在本文件，并附版本号。
- 适配层同样只输出 `JobEvent` 与产物。

## 5.3 dsh driver

- 使用 `dsh --profile sdk` 或 `--profile acp`，JSON-RPC stdio。
- 只依赖公开协议；禁止 import 其内部包，禁止读取 Harness home 的私有文件。
- 版本固定，升级视为独立变更，必须重跑契约测试。
- 适合需要 browser-use / computer-use / 多子 agent 的复杂任务。

## 5.4 pipeline driver

数据流：

```text
runner → 队列(step) → worker → 输出目录 → runner 收集
```

约定：
- worker 无状态，输入从 workspace 读，输出写 `outputDir`，进度写结构化事件。
- 大文件不经过队列，只传路径与元数据。
- 每个步骤幂等：同一输入重复执行结果一致，或显式标记不可重入。
- 支持 checkpoint：每完成一个可续单元写 `checkpoint.json`。

首版 worker：
| worker | 语言 | 说明 |
|---|---|---|
| `workers/tts` | TypeScript | 章节/角色切分、音色映射、分块合成、checkpoint、WAV 拼接 |
| `workers/audio-post` | Python/FFmpeg | 响度归一、非 WAV 拼接、章节标记（M4） |
| `workers/video` | Node/FFmpeg | 分镜合成、字幕、转场、编码（M4） |
| `workers/llm` | Node | 统一走模型网关，不做 provider 特判 |

`workers/tts` 的 provider 通过 `TTS_PROVIDER` 选择：

- `fake`（默认）：确定性 WAV，用于开发与测试。
- `dashscope` / `bailian`：阿里云百炼 `qwen-audio-3.1-tts-flash`，端点 `https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`，默认音色 `longanhuan_v3.1`；密钥取 `DASHSCOPE_API_KEY` 或 `BAILIAN_API_KEY`。
- `http`：兼容服务，`TTS_HTTP_URL` + `TTS_HTTP_TOKEN`。

真实音色 ID 由 `voiceMap` 指定；`narrator`、`default`、`旁白`、`对白` 等占位值会回落到 `TTS_DEFAULT_VOICE`。真实冒烟：`pnpm smoke:tts`。

- 限流重试：HTTP provider 对 `429 / 5xx` 使用与 LLM 相同的指数退避；`TTS_MAX_ATTEMPTS`、`TTS_RETRY_BASE_MS` 可调。

`workers/llm`：`script.generate` 与 `storyboard.plan` 共用。默认启发式生成，配置 `LLM_HTTP_URL` / `LLM_MODEL` 后走 OpenAI 兼容接口并解析 JSON；输出格式见能力包 README。

- 限流重试：`429 / 500 / 502 / 503 / 504` 与网络错误自动指数退避，优先遵循 `Retry-After`；`LLM_MAX_ATTEMPTS`、`LLM_RETRY_BASE_MS`、`LLM_TIMEOUT_MS` 可调。
- 真实冒烟：`pnpm smoke:llm`，读取 `LLM_HTTP_URL` / `LLM_MODEL` / `LLM_HTTP_TOKEN`，先验 provider，再跑一遍 `script.generate`。密钥只走环境变量，不落仓库。

`workers/video`：消费分镜 JSON，生成 BMP 画面、调用 ffmpeg 合成 MP4 与 SRT；`FFMPEG_BIN`、`VIDEO_WIDTH/HEIGHT/FPS` 可配置。ffmpeg 缺失时返回 `FFMPEG_UNAVAILABLE`。

断点与续作：

- 工作区固定为 `<workspaceRoot>/clouddeck-job-<jobId>`，`resumable` 能力失败时保留。
- 驱动按块写 `output/checkpoint.json`，重跑时校验块文件存在后跳过。
- `POST /v1/jobs/:id/resume` 复用同一 jobId 与工作区，`resume_count` 递增。

## 5.5 沙箱规范

M2 实现两种沙箱，由 runner 通过 `SANDBOX_DRIVER` 选择：

- `local`：本地子进程 + 独立进程组 + 环境白名单。**不是安全边界**，仅用于开发与 CI，网络权限不生效。
- `docker`：`--rm --init --read-only --tmpfs /tmp --user 1000:1000 --memory --cpus`，只挂载工作区根目录，网络默认 `none`。
  - `SANDBOX_RUNTIME=runsc` 可切换到 gVisor；`pnpm sandbox:check` 预检 Docker 与运行时注册状态。
  - 代码路径已就绪，但本机未安装 `runsc`，gVisor 尚未做真实逃逸/兼容性验证。

每个 job 一个容器：

| 项 | 要求 |
|---|---|
| 用户 | 非 root，随机 UID |
| 根文件系统 | 只读；仅 `/workspace`、`/tmp` 可写 |
| 网络 | 默认 `none`；按 manifest `permissions.network` 建白名单，域名级 egress |
| 资源 | CPU/内存/磁盘硬限制；GPU 按需挂载 |
| 超时 | `maxDurationMs` 到点强制终止 |
| 密钥 | 启动时注入 env，进程结束即失效；不写磁盘 |
| 日志 | stdout/stderr 采集并脱敏后入库 |
| 清理 | job 结束销毁容器与工作区；产物已上传对象存储 |

演进：首版 Docker + 只读根 + 网络白名单；M4 评估 gVisor / Firecracker，尤其是 `coding.assist`。

## 5.6 路由、降级与灰度

```yaml
routing:
  - when: { tenantTier: pro, gpu: true }
    driver: tts-local
  - when: { region: cn }
    driver: tts-cloud-cn
  - default:
    driver: tts-cloud
```

- 路由在控制面解析为具体 driver，写入 `jobs.driver_id`，保证可追溯。
- 降级只允许「同能力、同输入输出类型」的 driver 之间发生，且必须记录 `fallbackFrom`。
- 灰度：按租户白名单或百分比；新 driver 默认只对内部租户开放。
- 熔断：某 driver 连续 N 次失败自动摘除，告警并回退默认。

## 5.7 driver 契约测试

每个 driver 必须通过同一套用例：

1. 正常路径：返回 done，产物类型/数量正确。
2. 取消：运行中取消，30s 内事件流结束，无残留进程。
3. 超时：超过 `maxDurationMs` 被终止，状态为 failed。
4. 超预算：usage 超限被终止，状态为 failed，错误码 `BUDGET_EXCEEDED`。
5. 权限：访问白名单外域名失败；写入 `/workspace` 外失败。
6. 幂等：重复 submit 不产生重复产物（或明确返回同一 externalId）。

契约测试跑在 CI 的 `driver-contract` job，任何 driver 变更必须全绿。
