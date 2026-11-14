# ADR-0017 对外准备：支付、推送、安全加固与负载验证

- 状态：已接受
- 日期：2026-11-14

## 背景

内测就绪后，对外需要的工程项包括支付/账单、移动端推送、安全加固与容量验证。支付渠道与 FCM/APNs 需要外部账号，无法在本仓库内完成真实联调；因此采用「可替换 provider + mock」完成软件侧，并在文档中标注真实联调前提。

## 决策

1. **支付**
   - `PaymentProvider` 契约：`createCheckout` 与 `parseWebhook`。
   - `mock`：返回本地 checkout URL，回调用 HMAC 签名，测试与内测可用。
   - `http`：POST 到 `PAYMENT_HTTP_URL` 获取 checkout，回调同样 HMAC；可对接 Stripe/支付宝等网关的薄适配层。
   - 支付单落 `payments`，回调按 `provider + external_id` 定位（SECURITY DEFINER），成功后将租户套餐升级到对应 tier。
   - 税务发票不在系统内生成；账单提供可打印 HTML，供浏览器打印为 PDF。

2. **移动端推送**
   - 服务端保存 `device_tokens`，提供注册/删除接口。
   - 任务终态由 runner 调用 `PUSH_PROVIDER`：`mock` 记录日志，`http` POST 到推送网关。
   - FCM/APNs 客户端接入需要 Firebase/APNs 项目；Flutter 侧未硬编码。

3. **安全加固**
   - 全局 Helmet 安全响应头。
   - 全局 API 限流 `RATE_LIMIT_MAX`（默认 300/分钟）；登录/注册 20/分钟，公开分享 120/分钟。
   - `/metrics` 无鉴权，部署时必须只暴露在内网或由网关保护。

4. **负载验证**
   - 新增 `pnpm load:test`：并发数、时长、路径、token 可配。
   - 真实 Postgres 单实例实测（20 并发、5 秒、`/v1/projects`）：20,274 请求、0 错误、约 4,053 rps、p95 7ms、p99 9.7ms。
   - 该结果只代表本机单实例与简单读接口，不代表媒体任务或公网容量。

## 明确仍需外部条件

- 真实支付渠道与商户资质（当前 mock/http 可接，但无真实商户号）
- 税务发票/合规开票服务
- FCM/APNs 项目与证书（服务端已就绪，客户端未接）
- 多语言文案与协同编辑方案

## 后果

正面：
- 支付、推送、限流都有可替换实现与测试，不被外部账号阻塞开发。
- 账单可直接打印，减少财务沟通成本。
- 有可重复的负载脚本与基线数据。

代价：
- mock 支付没有任何真实资金流。
- 推送服务端测试使用 mock，真实 FCM 负载未验证。
- 负载基线不可直接外推。

## 验证

- `pnpm check`：110 个测试通过（secrets 4、contracts 15、tts 18、llm 8、sandbox 6、db 3、video 4、claude-code 4、runner 6、control-plane 33、边界 9）。
- 负载实测数据见上；环境已在测试后清理。
