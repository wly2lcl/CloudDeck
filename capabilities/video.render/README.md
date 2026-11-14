# video.render

M4 的确定性视频合成能力：分镜 → 逐镜画面 → Ken Burns 镜头 → 拼接 → 混入配音。

- 输入：`storyboard`（必需）、`audio_track`（可选）
- 输出：`video`（MP4）、`subtitles`（SRT）、首帧预览图
- 依赖：宿主或沙箱镜像内需要 `ffmpeg`（libx264 + aac）
- 不做：生成式视频、字幕烧录（当前输出独立 SRT）

## 验收

- 分镜 JSON → 视频文件可播放，时长等于分镜总时长
- 有配音时自动混流；无配音时生成静音视频
- 字幕文件与镜头时间对齐
- 单镜失败可重试，错误信息包含 ffmpeg stderr 尾部
