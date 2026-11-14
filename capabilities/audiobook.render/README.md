# audiobook.render

M3 的媒体长任务能力：把稿件按章节、角色拆分并合成为有声书。

- 驱动：`workers/tts`
- 输入：`novel_manuscript` 或 `script`
- 输出：逐章 `audio_track` + 合并版 `audiobook`
- 断点：以「块」为最小单元写 `checkpoint.json`，失败后工作区保留，可续作
- 音色：`voiceMap` 为角色到音色的 JSON 映射，未匹配时回落到 `defaultVoice`

## Provider

- `fake`（默认）：生成确定性 WAV，用于本地开发与测试
- `http`：`TTS_PROVIDER=http` + `TTS_HTTP_URL`，向兼容服务 POST `{text, voice, format}`，接受二进制或 `{audioBase64}`

本地 CosyVoice 或 DashScope 网关都可以按这个契约接入；未验证的云接口不硬编码。

## 验收

- 上传多章稿件，运行后得到逐章音频与合并音频
- 中途失败后点「续作」，只合成未完成块
- 单块失败可重试，已完成块不重复计费
- 成本随字数增长，超出预算立即终止
