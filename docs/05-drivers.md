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
| `workers/tts` | Python | 收编 NovelAudio 的双路线（CosyVoice 本地 / DashScope 云端） |
| `workers/audio-post` | Python/FFmpeg | 响度归一、拼接、章节标记 |
| `workers/video` | Node/FFmpeg | 分镜合成、字幕、转场、编码 |
| `workers/llm` | Node | 统一走模型网关，不做 provider 特判 |

## 5.5 沙箱规范

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
