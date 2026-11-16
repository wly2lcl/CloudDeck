# 08 安全与计费

## 威胁模型

| 威胁 | 场景 | 缓解 |
|---|---|---|
| 跨租户数据泄露 | 越权访问他人项目/资产 | 强制 tenant 过滤 + RLS + 跨租户返回 404 |
| 沙箱逃逸 | 第三方 agent 执行恶意代码 | 非 root、只读根、无网络默认、资源限制；M4 上 gVisor |
| 密钥泄露 | 日志/产物/前端带出密钥 | 密钥只注入 runner；日志脱敏；产物扫描 |
| 模型成本滥用 | 循环或提示注入导致烧钱 | 单 job 预算、并发限制、异常用量熔断 |
| 提示注入 | 稿件内嵌指令操控 agent | 输入标注为不可信数据；工具权限最小化；输出校验 |
| 版权与声音克隆 | 用户上传他人作品/未授权音色 | 上传声明、音色授权确认、投诉下架流程 |
| 内容合规 | 生成违法或侵权内容 | 输入输出审核、举报与封禁 |

## 密钥管理

首发仅支持租户 BYOK；平台级密钥池只用于内部与试用租户，是否对外开放由 M3 的条款核对结论决定（见 ADR-0008）。能力通过 manifest 的 `credentials.policy` 声明可用凭据类型。

- 租户 BYOK：AES-256-GCM 加密后存 `model_credentials`，格式 `v1:<iv>:<tag>:<ciphertext>`，展示只给 `key_hint`（末四位）。
- 主密钥：来自 `CREDENTIALS_KEY`；未设置时回退 `AUTH_SECRET`（仅开发）。生产必须独立配置高熵随机值。
- 注入方式：runner 先读进程环境，缺失时按 provider 映射解密租户凭据，任务启动时注入，进程结束即失效。
- 禁止：写入镜像、写入 workspace、打印到日志、返回给客户端。
- 轮换：设置 `CREDENTIALS_KEY_PREVIOUS` 后调用 `POST /v1/model-credentials/rotate`，逐条解密-重加密；不是原子操作，失败项可重跑。
- 使用记录：runner 成功解密后更新 `last_used_at`，用于排查闲置与异常凭据。

## 模型网关

> **实现状态（v0.1.13 开发中）**：worker 级网关支持主/备 provider 降级；控制面新增
> `/v1/gateway/chat` 预算校验与 OpenAI 兼容代理。短期 token、跨 driver 自动路由仍未落地。

目标设计是所有模型调用经过 `control-plane` 的模型网关，不直连 provider：

- 统一多 provider 路由、重试、降级、超时。
- 统一计费与用量归属（按 job/tenant/capability）。
- 统一审计与脱敏。
- driver 通过短期 token 调用网关；网关校验该 job 的权限与预算。
- 记录 `credentialSource`（platform / tenant），计费与审计按来源区分。

## 沙箱细则

| 项 | 规则 |
|---|---|
| 镜像 | 按 worker 类型构建，固定 digest，禁止 latest |
| 启动用户 | 非 root，随机 UID，只读根 |
| 挂载 | `/workspace`（输入副本 + 输出）、`/tmp`（临时）；不挂载宿主 socket |
| 网络 | 默认 `none`；按 manifest 建域名白名单；禁止访问内网段与元数据服务 |
| 资源 | CPU/内存/磁盘硬限制；GPU 独占或分片 |
| 时间 | 硬超时，到点 SIGTERM → 10s → SIGKILL 进程树 |
| 清理 | 容器 + 卷 + 临时凭证全部销毁；失败也销毁 |

`coding.assist` 额外要求：独立节点池、无平台网络、镜像只含必要工具链、产出 patch 而非直接合并。

## 权限模型

能力 manifest 声明，平台执行：

- `permissions.network`：白名单域名；空数组 = 禁网。
- `permissions.filesystem`：首版只允许 `workspace-only`。
- `permissions.secrets`：只能引用已注册的密钥名。
- `permissions.allowShell`：默认 false；开启需平台管理员审批并记审计。
- `resources.gpu`：`none` / `optional` / `required`。

平台在提交与启动两个阶段各校验一次；运行中出现越权（网络/文件）直接终止并标记 `SECURITY_VIOLATION`。

> 数据库连接约定：控制面连接以租户事务设置 `app.tenant_id`，RLS 策略据此过滤；job-runner 需要跨租户领取任务，生产环境应使用带 `BYPASSRLS` 的专用角色，开发环境可使用表所有者连接。RLS 的策略测试见 `packages/db/test/rls.test.ts`。

## 计量与计费

计量点：

| 单位 | 来源 | 示例 |
|---|---|---|
| `per_1k_chars` | TTS 输入字数 | 有声 |
| `per_token` | 模型网关 usage | 写作、剧本 |
| `per_minute` | 音视频时长 | 视频合成 |
| `per_job` | 固定价能力 | 导出、质检 |

流程：

1. 提交：按 manifest `estimate` 预扣额度。
2. 运行：driver 上报 `usage`，累计实时展示。
3. 结束：按 `usage_ledger` 结算，多退少补。
4. 超预算：立即取消，已产生费用照实计。

账单口径：
- 按 `tenant + period + capability + driver` 聚合。
- 平台成本（模型采购价）与用户价分离，两者都可能变化，账单只展示用户价。
- 退款仅针对平台故障导致的全额失败，需管理员审批。
- 支付回调：`x-payment-signature` 为 `HMAC-SHA256(secret, JSON.stringify(body))`；校验失败返回 403。
- 限流：全局 `RATE_LIMIT_MAX`（默认 300/分钟），登录/注册 20/分钟，公开分享 120/分钟。
- 安全头：Helmet 全量响应头；`/metrics` 无鉴权，必须限制在内网或网关后。

## 只读分享

- token 为 32 字节随机值，库内只存 SHA-256；默认 7 天，可撤销。
- 公开接口只返回项目/资产元数据与文本预览，不返回媒体原文件与下载地址。
- 公开查询先通过 `SECURITY DEFINER` 函数按 token 定位分享，再进入对应租户上下文，避免绕过 RLS。
- 后续如开放媒体预览，必须使用短期签名 URL 并记录访问审计。

## 配额

| tier | 并发 job | 月预算 | 单 job 上限 | 存储 |
|---|---|---|---|---|
| free | 1 | $5 | $1 | 2GB |
| pro | 4 | $100 | $5 | 50GB |
| team | 16 | $1000 | $20 | 500GB |

- 并发与预算超限在提交时拒绝；运行中超预算终止。
- 配额可被管理员按租户覆盖。

## 审计

必须记录且不可篡改（追加写 + 定期归档）：

- 登录、失败登录、refresh 轮换
- 成员与角色变更、API key 增删
- 能力启停、driver 路由变更
- job 取消、重试、续作
- 数据导出、资产删除
- 密钥创建/轮换/吊销
- 越权与安全违规事件

保留期：审计 1 年，任务事件 90 天，产物按租户套餐。

## 合规检查单

- [ ] 用户协议与隐私政策
- [ ] 上传内容版权声明与投诉通道
- [ ] 声音克隆需显式授权（本人或权利人）
- [ ] 生成内容标识（AI 生成水印/元数据，按地区要求）
- [ ] 数据存储区域与跨境说明
- [ ] 未成年人保护与内容分级
- [ ] 第三方 agent 的商用条款核对（见 12 待决策）
