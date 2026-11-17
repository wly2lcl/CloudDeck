# 04 能力设计

> **实现状态（v0.1.4 开发中）**：
> `novel.edit` 支持向量 RAG（配置 `EMBEDDING_HTTP_URL/MODEL` 时）与词法 RAG-lite 回退；
> 有声合成默认 2 路并发，每块做峰值归一，最终音轨优先用 ffmpeg loudnorm 归一到 -16 LUFS；
> 视频镜头加入首尾淡入淡出，仍不是交叉溶解转场；`voice_profile` 资产类型已定义但
> 尚未接入 manifest，音色通过 `params.voiceMap` 或角色音色库 `voiceProfileId` 传入。

## 能力包结构

```text
capabilities/<id>/
  capability.yaml          # manifest（见 02）
  workflow.yaml            # 步骤图；单步能力可省略
  prompts/                 # 提示词、agent 定义
  schemas/
    form.json              # 参数 JSON Schema
    result.json            # 结果附加结构（可选）
  ui/form.json             # 表单分组、字段顺序、控件提示
  README.md                # 能力说明与验收口径
  test/                    # 契约测试与样例输入
```

能力包只允许依赖 `@clouddeck/capability-sdk` 与 `@clouddeck/contracts`。

## workflow.yaml

```yaml
version: 1
steps:
  - id: parse
    agent: llm
    with: { model: fast, prompt: prompts/parse.md }
    inputs: [manuscript]
    outputs: [{ name: chapters, assetType: dataset }]

  - id: cast
    agent: llm
    when: "params.voiceMap == null"
    inputs: [chapters]
    outputs: [{ name: cast, assetType: voice_profile }]

  - id: synth
    agent: tts
    forEach: chapters.items          # 并行扇出，受 concurrency 限制
    inputs: [chapters, cast]
    outputs: [{ name: audio, assetType: audio_track, multiple: true }]

  - id: merge
    agent: ffmpeg
    inputs: [audio]
    outputs: [{ name: audiobook, assetType: audio_track }]
```

步骤语义：
- `agent` 指向 driver 注册表中的执行单元；同一能力可混用多种引擎。
- `forEach` 扇出，失败按 `retry` 策略按项重试，成功项不重跑（断点续作的基础）。
- 步骤间只传资产，不传内存对象。
- 每步产物都登记为 job artifact，最终由 manifest `outputs` 决定哪些进资产库。

## 1. novel.edit 小说编辑协助

**目标**：在不破坏作者文风的前提下，提供续写、改写、一致性检查、角色补全。

| 项 | 内容 |
|---|---|
| 输入 | `novel_manuscript`（必需）、`story_bible`、`character_card`（可选） |
| 输出 | 稿件新版本、批注文档 |
| 执行模式 | async，可流式预览 |
| driver | `agent-cli`（Claude Code / 通用 LLM 均可） |
| 关键步骤 | 分章切片 → 检索相关前文（RAG）→ 生成候选 → 自检（AI 味/一致性）→ 落版本 |
| 失败处理 | 单章失败不影响其他章；候选生成失败自动降模型重试一次 |
| 验收 | 10 万字稿件，定位某章续写，输出引用正确的前文；改写后设定冲突数为 0（人工抽检 20 段） |

**不做**：自动整本重写、绕过作者确认直接改稿。

## 2. script.generate 剧本生成

| 项 | 内容 |
|---|---|
| 输入 | `novel_manuscript` 或大纲 `document`、`story_bible` |
| 输出 | `script`（标准剧本格式）、`shot_list`（可选） |
| driver | `llm` / `agent-cli` |
| 关键步骤 | 抽取主线与角色 → 分幕 → 分场 → 对白 → 格式校验 |
| 验收 | 1 万字小说 → 3 幕 12 场剧本，角色名与设定库一致率 100%，场次可按章回溯到原文 |

M4 实现：未配置模型时使用确定性启发式（章节 → 幕/场、提取对白与角色）；配置 `LLM_HTTP_URL` 后走 OpenAI 兼容 `chat/completions` 并要求 JSON。输出 Markdown，场景标题固定为 `### 第 N 场 标题`，供分镜解析。

## 3. audiobook.render 有声小说生成

| 项 | 内容 |
|---|---|
| 输入 | `novel_manuscript` / `script`、`voice_profile`（可选） |
| 输出 | 逐章 `audio_track`、合并版 `audio_track` |
| driver | `pipeline`（Python TTS worker） |
| 路由 | 有 GPU → 本地 CosyVoice；否则 → DashScope 云端 |
| 关键步骤 | 章节切分 → 旁白/对白/角色识别 → 音色分配 → 分块合成 → 响度归一 → 拼接 → 质检 |
| 断点 | 以「章节 + 块」为最小单元落盘，重启只补失败块 |
| 限额 | 单 job 默认 6h / 5 USD；超限终止并保留已完成章节 |
| 验收 | 10 万字、5 角色，30 分钟内完成；中断后恢复只重跑未完成块；AZ 与云端两种路由结果时长差 < 2% |

M3 实现（`workers/tts`）：

- Provider 契约：`synthesize({text, voice, format}) -> Buffer`；`fake` 生成确定性 WAV，`http` 对接兼容 TTS 服务（CosyVoice / DashScope 网关）。
- 切分：章节标记或 Markdown 标题 → 段落 → 句子；识别旁白、引用对白与 `角色：内容` 形式。
- 音色：`voiceMap`（角色 → 音色 JSON）+ `defaultVoice` 回落。
- 断点：每块写 `checkpoint.json`；失败保留工作区，`POST /v1/jobs/:id/resume` 复用同一 job 续作。
- 拼接：WAV 直接按 RIFF 头拼接，不依赖 ffmpeg。

## 4. storyboard.plan 分镜规划

| 项 | 内容 |
|---|---|
| 输入 | `script`、风格参考 `image`（可选） |
| 输出 | `storyboard`（每场若干镜）、`shot_list` |
| driver | `llm` + 可选图像生成 |
| 关键步骤 | 场次拆镜 → 镜头描述结构化（景别/机位/时长/画面）→ 一致性校验（角色/服装/场景） |
| 验收 | 12 场剧本产出 ≥ 40 镜，角色与场景引用 100% 可解析为结构化字段 |

M4 实现：输出 JSON `{title, shots:[{index, scene, description, shotSize, camera, durationMs}]}`；未配置模型时按剧本场景与对白生成每场 N 个镜头。

## 5. video.render 视频合成

| 项 | 内容 |
|---|---|
| 输入 | `storyboard`、`audio_track`、`image`/素材 |
| 输出 | `video` |
| driver | `pipeline`（Node/FFmpeg；可接 ComfyUI 独立进程） |
| 关键步骤 | 素材生成/筛选 → 每镜合成 → 字幕与配音对齐 → 转场 → 成片编码 |
| 限额 | 单 job 默认 2h / 8 USD |
| 验收 | 3 分钟成片，音画同步偏差 < 100ms，失败镜头可单独重跑 |

**实现建议**：首版不追求生成式视频，先用「分镜图 + Ken Burns + 转场 + 配音」跑通链路；生成式模型作为可替换的镜头渲染 driver。

M4 实现：逐镜生成 BMP 画面 → ffmpeg `zoompan` 缓推 → concat 拼接 → 可选混入配音；字幕输出独立 SRT（当前 ffmpeg 无 libass，不做烧录）。依赖宿主或镜像内的 ffmpeg（libx264 + aac）。

## 6. coding.assist AI 编程（M5 可选）

| 项 | 内容 |
|---|---|
| 输入 | `code_workspace` |
| 输出 | `patch`、审查报告 |
| driver | `agent-cli`（Claude Code / OpenCode / dsh） |
| 隔离 | 必须独立沙箱，禁止访问平台网络，只挂载工作区 |
| 验收 | 给定仓库与需求，产出可应用的 patch，测试通过率与基线一致 |

## 内容链优先级

```text
story_bible ─→ novel_manuscript ─→ script ─→ storyboard ─→ video
                        └────────→ voice_profile ─→ audio_track ─┘
```

实现顺序（也是里程碑顺序）：
1. `novel.edit`（打通资产与版本）
2. `audiobook.render`（打通长任务、GPU、断点）
3. `script.generate` → `storyboard.plan` → `video.render`（打通多步骤流水线）
4. `coding.assist`（可选，验证 agent-cli driver 的通用性）

## 能力上新检查单

- [ ] manifest 通过 lint，输入输出类型在枚举内
- [ ] 有 `test/` 样例输入与期望产物断言
- [ ] 有明确的失败分类与 retryable 标记
- [ ] 声明权限、资源、预算上限
- [ ] 客户端仅靠 `ui/form.json` 与 `result` 渲染器即可用，无需改代码
- [ ] 在 staging 用两个 driver 各跑通一次（若声明了路由）
