# novel.edit

M2 的第一个真实能力：由 Claude Code 在沙箱中执行小说续写、改写与一致性检查。

- 驱动：`drivers/claude-code`
- 输入：`novel_manuscript`（必需）、`story_bible`（可选）
- 输出：新的 `novel_manuscript`
- 凭据：租户 BYOK，`ANTHROPIC_API_KEY` 由运行环境注入
- 预算：单次 ≤ 3 USD，最长 30 分钟

## 执行流程

1. runner 下载稿件到工作区。
2. Claude Code 以 `stream-json` 模式运行，读取稿件并写入 `output/result.md`。
3. 驱动把进展映射为 `job_events`，完成后产物入库并建立内容链。

## 验收

- 上传一份有一定长度的稿件，选择 `continue`，得到新的稿件版本
- 在任务页能看到工具调用与完成事件
- 取消任务后进程树被终止，无残留
- 未注入 `ANTHROPIC_API_KEY` 时任务失败，错误码可读
