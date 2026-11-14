# 07 客户端

Web 与移动端共用一套 API、一套契约、一套渲染规则。客户端不得包含任何能力专属业务逻辑。

## 共同原则

1. **能力列表来自服务端**：首页、导航、入口全部由 `GET /capabilities` 驱动，新增能力不改客户端。
2. **表单由 schema 驱动**：`ui/form.json` + JSON Schema 渲染，字段级控件提示写在 schema 扩展里。
3. **结果由 asset type 驱动**：每种资产类型对应一个渲染器，注册在 `packages/ui/renderers`。
4. **进度统一**：所有任务都走 `job` 页面与 SSE，不为单个能力写专用进度条。
5. **错误统一**：按错误码给文案与操作（重试/续作/充值/联系管理员）。

## Web（Next.js App Router）

路由：

```text
/                         项目列表
/p/:projectId             项目概览（内容链图 + 最近任务）
/p/:projectId/assets      资产库（按类型筛选）
/p/:projectId/run/:capId  能力运行页（schema 表单 → 提交 → 进度 → 结果）
/p/:projectId/jobs/:jobId 任务详情（事件流、日志、产物）
/settings/*               租户、成员、密钥、计费
```

技术要点：

- 服务端组件取初始数据，客户端组件负责 SSE 与交互。
- 状态：TanStack Query 管服务端状态；不上大型全局 store。
- 上传：直传 S3（预签名 URL），带分片与断点。
- 内容链：用 DAG 视图渲染 `asset_links`，节点可点开预览与「基于此资产运行能力」。

## 移动端（Flutter）

首版只做三件事：

1. 项目与资产浏览（只读 + 预览）
2. 任务进度与通知（SSE 前台，推送兜底）
3. 音频播放与视频播放

明确不做：复杂表单编辑、内容链编辑、批量任务配置。移动端定位是「随身看进度、听成品、做轻量确认」。

技术要点：

- 客户端 SDK：由 `packages/contracts` 生成的 OpenAPI 产出 Dart 客户端，CI 重新生成并校验，禁止手改。
- 播放器：`just_audio`（音频，后台播放与锁屏控制）+ `video_player`（视频）。
- 推送：FCM（Android）/ APNs（iOS），job 终态触发；前台仍以 SSE 为准。
- 本地缓存：`drift`（SQLite）缓存项目与资产元数据；不做离线编辑。
- 深链：`/p/:projectId/jobs/:jobId`，通知点击直达任务页。
- UI：Material 3 + 平台自适应；共享 design token 由 `packages/ui/tokens` 导出 JSON，Flutter 侧生成 Dart 常量。
- 构建：Android / iOS 各自 CI job，签名与产物归档。

相对 Expo/RN 的代价：

- 契约与 token 不能直接复用 TS 类型，必须维护「OpenAPI → Dart」与「token JSON → Dart」两条生成链，CI 校验生成物未漂移。
- 多一套工具链（Flutter SDK、Gradle、Xcode），CI 时间更长。
- schema 表单渲染器需在 Dart 侧独立实现，能力上新时两端都要回归。

收益：

- 团队已有 Flutter 产品经验（NovelPhone），移动端交付确定性更高。
- 媒体播放、后台任务、长列表与动画的性能和一致性更好。
- 一套代码覆盖 Android/iOS，后续可评估桌面端。

## schema 驱动表单

```jsonc
// capabilities/audiobook.render/ui/form.json
{
  "groups": [
    { "title": "输入", "fields": ["manuscript", "voiceMap"] },
    { "title": "参数", "fields": ["language", "chapterRange", "speed"] }
  ],
  "widgets": {
    "manuscript": { "type": "asset-picker", "accept": ["novel_manuscript", "script"] },
    "voiceMap": { "type": "voice-mapper", "optional": true },
    "chapterRange": { "type": "range", "min": 1, "max": "auto" }
  }
}
```

- 未声明的字段用默认控件（string → input，enum → select，number → number）。
- 控件类型是有限的平台内置集合；新控件需要改客户端，因此能力上新检查单要求优先用内置控件。
- 校验在前端与服务端各做一次，以服务端为准。

## 资产渲染器

| assetType | Web | 移动端 |
|---|---|---|
| `novel_manuscript` / `script` | 富文本只读 + 版本 diff | 纯文本阅读 |
| `audio_track` | 播放器 + 章节列表 + 波形 | 播放器 + 后台播放 |
| `video` | 播放器 + 时间轴 | 播放器 |
| `image` | 画廊 | 画廊 |
| `storyboard` / `shot_list` | 卡片/表格 | 列表 |
| `document` | Markdown/PDF | Markdown |
| 其他 | 下载卡片 | 下载卡片 |

新增 assetType 必须同时补 Web 与移动端渲染器，否则回退到下载卡片。

## 交互约定

- 长任务提交后**立即**进入任务页，不阻塞在按钮 loading。
- 进度页展示：阶段名、百分比、已用时长、预估剩余、已产生成本。
- 失败页必须给出：错误码、可读原因、是否可重试、已完成部分产物。
- 成本相关操作（重试、续作、批量）先展示预估再确认。
- 所有破坏性操作二次确认，且确认文案说明影响范围（资产/版本/任务）。

## 设计系统

- 组件库：Web 用 shadcn/ui + Tailwind；移动端用 Flutter Material 3 + 共享 token（JSON 为单一来源）。
- 共享 token：颜色、间距、字号放在 `packages/ui/tokens`，双端同源。
- 深色模式与无障碍（对比度、焦点顺序、读屏标签）作为 M1 验收项，不后补。
- 中文为默认语言，文案集中管理，预留 i18n key。
