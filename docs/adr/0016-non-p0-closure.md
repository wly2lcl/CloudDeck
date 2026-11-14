# ADR-0016 非 P0 收口：轮换、对账、指标、gVisor、模板市场与实时评论

- 状态：已接受
- 日期：2026-11-14

## 背景

P0 收口后剩余事项分为两类：可在代码内闭环的工程项，以及依赖外部账号/硬件/内容的项。本 ADR 记录前者已实现、后者被明确阻塞的原因。

## 决策

1. **凭据主密钥轮换**
   - 新增 `CREDENTIALS_KEY_PREVIOUS`；`POST /v1/model-credentials/rotate` 用旧密钥解密、当前密钥重加密。
   - 轮换逐条执行，返回 `rotated / failed / total`；失败不回滚已成功项。
   - runner 解密成功后更新 `last_used_at`。

2. **账单对账与发票快照**
   - `GET /v1/billing/reconciliation`：按任务比较预估与实际用量，给出偏差。
   - `invoices` 表按 `(tenant, period)` 唯一；`POST /v1/billing/invoices` 生成不可变快照，重复调用返回既有账单。
   - 不接支付网关、不生成税务发票 PDF；这两项需要商户资质与法务流程。

3. **可观测性**
   - `GET /metrics` 输出 Prometheus 文本：存活、任务状态计数、累计用量、HTTP 请求计数。
   - 指标端点默认无鉴权，部署时应只暴露在内网或由网关保护。

4. **gVisor 支持**
   - `DockerSandbox` 支持 `runtime`，runner 通过 `SANDBOX_RUNTIME` 传入（如 `runsc`）。
   - `pnpm sandbox:check` 预检 Docker 可用性与运行时注册状态。
   - 当前机器未安装 `runsc`，预检会明确失败；代码路径已就绪。

5. **模板市场**
   - `templates.is_public`；公开列表与读取通过 `SECURITY DEFINER` 函数跨租户查询。
   - 其他租户可导入公开模板，生成自己的副本；公开模板本身不可被修改或删除。

6. **评论实时流**
   - `GET /v1/projects/:id/comments/stream` 以 SSE 轮询增量评论，Web 项目页自动追加并去重。
   - 这是评论级实时，不是多人同时编辑正文的协同编辑。

## 明确阻塞（无字段内容可实现）

| 项 | 阻塞原因 | 解冻条件 |
|---|---|---|
| 支付/退款 | 需要商户号、支付渠道与结算协议 | 完成商户接入与合规评审 |
| 税务发票 PDF | 需要开票资质与税号信息 | 接入合规开票服务 |
| 移动端推送 | 需要 FCM/APNs 项目与证书 | 提供 Firebase/APNs 凭据 |
| OpenCode / dsh driver | 本机未安装，接口未验证 | 安装并做契约测试后接入 |
| 生成式视频 | 需要可用的视频模型与额度 | 选定模型并完成成本/审核评估 |
| 多语言 UI | 需要翻译文案与本地化评审，不是纯代码缺陷 | 提供目标语言文案 |
| 多人协同编辑 | 需要 CRDT/OT 与冲突策略 | 单独立项 |

## 验证

- 测试总数 105：secrets 4、contracts 15、tts 18、llm 8、sandbox 6、db 3、video 4、claude-code 4、runner 5、control-plane 29、边界 9。
- 新增测试覆盖：凭据轮换、last_used_at、对账与发票幂等、指标端点、模板公开/跨租户导入、评论 SSE 回放、Docker 运行时参数。
- gVisor 预检实测：Docker 29.2.1 可用，`runsc` 未注册，脚本按预期失败并列出可用运行时。

## 后果

正面：
- 凭据可轮换，账单可对账，模板可跨租户复用，评论可实时到达。
- 指标端点提供最小可观测面。
- gVisor 只差运行时安装，不需要改应用代码。

代价：
- 轮换不是原子操作，部分失败需重跑。
- 发票快照不含支付状态流转。
- 指标为全局聚合，未按租户拆分。
- gVisor 未在真实 agent 场景验证。
