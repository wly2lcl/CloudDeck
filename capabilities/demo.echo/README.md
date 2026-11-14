# demo.echo

M1 的示例能力，用于验证「上传资产 → 创建 job → 事件流 → 产物入库 → 内容链」全链路。

- 驱动：`drivers/mock`（进程内模拟，不调用任何外部服务）
- 输入：任意 `document` 或 `novel_manuscript`
- 输出：带前缀的同内容 `document`
- 参数：进度步数、每步耗时、失败注入

## 验收

- 上传一个 txt，提交 job，进度到 100%，项目中出现新资产版本
- 传入 `failAtStep: 2` 得到失败 job，可重试
- 传入较大 `sleepMs` 后取消，job 在 30 秒内收敛为 cancelled
