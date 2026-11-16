# 可观测性

## 指标

控制面 `GET /metrics` 输出 Prometheus 文本格式：

- `clouddeck_up`：服务存活
- `clouddeck_jobs{status}`：各状态任务数
- `clouddeck_usage_usd_total`：平台累计用量金额
- `clouddeck_http_requests_total{method,status}`：HTTP 请求计数

`prometheus.yml` 是抓取配置示例，`alerts.yml` 包含控制面不可达、5xx 比例、
队列积压、失败任务四条告警。

## 日志

控制面使用 Fastify 结构化 JSON 日志（stdout），包含 `reqId`、`method`、`url`、
`statusCode`、`responseTime`。生产环境用 Fluent Bit / Vector / Loki 采集即可。

job-runner 当前输出普通文本日志；建议在容器层统一加 `service=job-runner` 标签。

## 接入

```sh
kubectl -n monitoring create configmap clouddeck-rules \
  --from-file=alerts.yml=infra/observability/alerts.yml
```

将 `prometheus.yml` 的 scrape 配置合并到现有 Prometheus，或部署
Prometheus Operator 的 `ServiceMonitor` 指向 `control-plane:4310`。
