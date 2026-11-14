# ADR-0014 真实模型接入与 429 限流重试

- 状态：已接受
- 日期：2026-11-14

## 背景

接入真实 OpenAI 兼容端点（`/v1/chat/completions`）后，首次请求即遇到 `429 RateLimitExceeded.EndpointTPMExceeded`，随后同一请求成功。说明限流是瞬时的，平台需要自动退避，而不是把 429 直接暴露为任务失败。

## 决策

1. **Provider 级重试**
   - `HttpLlmProvider` 对 `429 / 500 / 502 / 503 / 504` 与网络错误自动重试。
   - 指数退避：`base × 2^(n-1)`，上限 `maxRetryDelayMs`；优先采用响应头 `Retry-After`。
   - 默认 `maxAttempts=4`、`base=500ms`、`maxDelay=8s`，均可通过环境变量覆盖。
   - 重试耗尽后抛出包含状态码与响应体摘要的错误；任务层仍可按 `retryable` 重试或续作。

2. **TTS 一致行为**
   - `HttpTtsProvider` 使用相同的 429/5xx 退避策略，避免语音网关限流直接打断长任务。

3. **配置**
   - `LLM_MAX_ATTEMPTS` / `LLM_RETRY_BASE_MS` / `LLM_TIMEOUT_MS`
   - `TTS_MAX_ATTEMPTS` / `TTS_RETRY_BASE_MS`

4. **真实冒烟**
   - 新增 `pnpm smoke:llm`，读取 `LLM_HTTP_URL`、`LLM_MODEL`、`LLM_HTTP_TOKEN`，先验证 provider，再用 `script.generate` 驱动跑一遍真实模型。
   - 密钥只通过环境变量传入，不写入仓库、日志与文档。

## 证据（2026-11-14）

- 端点：OpenAI 兼容 `/v1/chat/completions`，模型 `deepseek-flash`。
- 首次请求返回 `429`，随后请求 `200`；provider 冒烟 1.9s 返回合法 JSON，usage 72+100 tokens。
- `script.generate` 真实生成 2 幕剧本，包含场景摘要、角色与对白，产物 `script.md` 265 字符。
- 429 重试逻辑由 mock 服务单测覆盖：一次 429 后成功、重试耗尽抛出可读错误。

## 后果

正面：
- 瞬时限流不再直接导致任务失败。
- 同一套策略适用于 LLM 与 TTS。
- 真实模型链路可用一条命令复验。

代价：
- 重试会拉长任务时延；持续限流仍会失败，需要用户重试或升级额度。
- 暂无多密钥轮换、provider 级熔断与跨渠道降级。

## 回滚/扩展条件

- 若持续出现 `429` 且单任务等待超过预算，引入多密钥轮换与 provider 降级（见 D3/D4）。
- 若重试导致重复计费，改为幂等请求键或服务端去重。
