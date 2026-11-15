# 部署指南

## 1. Docker Compose（单机）

```sh
cp infra/compose/.env.example infra/compose/.env
docker compose -f infra/compose/docker-compose.yml up --build -d
```

启动内容：

| 服务 | 说明 |
|---|---|
| `postgres` | 业务库，迁移在控制面启动时自动执行 |
| `redis` | 预留（当前任务队列在 Postgres） |
| `minio` | 可选对象存储；默认使用本地存储卷 |
| `control-plane` | API、鉴权、能力注册表、计费 |
| `job-runner` | 队列消费、沙箱、driver、产物 |
| `web` | Next.js 客户端 |

默认端口：Web `3000`、API `4310`、Postgres `5432`、MinIO `9000/9001`。

### 必须替换的配置

```sh
AUTH_SECRET=<random-64-hex>
CREDENTIALS_KEY=<random-64-hex>
POSTGRES_PASSWORD=<strong-password>
```

`AUTH_SECRET` 与 `CREDENTIALS_KEY` 必须不同；后者丢失将无法解密租户模型凭据。

### 使用 S3 / MinIO

在 `job-runner` 与控制面环境中设置：

```sh
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=clouddeck
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

控制面检测到 `S3_BUCKET` 后自动使用 S3 driver。

### GPU 与 TTS

本地 CosyVoice 或百炼网关二选一：

```sh
TTS_PROVIDER=dashscope
TTS_MODEL=qwen-audio-3.1-tts-flash
BAILIAN_API_KEY=...
```

GPU 节点使用 `infra/compose/docker-compose.gpu.yml`，并按 NVIDIA Container Toolkit 配置 Docker。

### 使用已发布镜像

```sh
VERSION=0.1.1 docker compose \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.release.yml \
  up -d --no-build
```

该组合只使用 GHCR 上的发布镜像，不会本地构建。发布后的 GitHub Release 会自动触发 `Release Smoke` workflow，拉取对应版本镜像并验证 API 与 Web。

## 2. 生产检查清单

- [ ] 替换默认密钥；`CREDENTIALS_KEY` 独立备份
- [ ] 使用托管 Postgres（开启备份与 PITR），不要用容器内卷
- [ ] 对象存储使用 S3/OSS，开启生命周期与版本
- [ ] 控制面置于反向代理之后，启用 HTTPS
- [ ] `/metrics` 仅内网暴露或加网关鉴权
- [ ] 限制公网访问的控制面路径（公开分享与支付回调除外）
- [ ] 设置 `RATE_LIMIT_MAX` 与反向代理限流
- [ ] job-runner 使用独立节点池；GPU worker 打标签调度
- [ ] 日志集中采集，`requestId` 贯穿
- [ ] 配置备份、恢复演练、告警
- [ ] 如启用 Docker 沙箱，runner 需要 Docker socket 或独立沙箱服务

## 3. 扩展 runner

当前 runner 是单进程轮询队列，可水平启动多个实例；`claimNextJob` 使用
`FOR UPDATE SKIP LOCKED`，不会重复领取。扩容时注意：

- 共享 `WORKSPACE_ROOT` 需要同一存储（NFS/对象存储挂载）
- GPU 任务按能力资源声明调度
- 每个 runner 的 `CAPABILITIES_DIR` 必须与版本一致

## 4. 密钥轮换

```sh
# 1. 设置新 CREDENTIALS_KEY，旧值放入 CREDENTIALS_KEY_PREVIOUS
# 2. 调用（owner/admin）
curl -X POST https://api.example.com/v1/model-credentials/rotate \
  -H "Authorization: Bearer $TOKEN"
# 3. 确认 rotated 数等于 total 后移除 CREDENTIALS_KEY_PREVIOUS
```

轮换逐条执行，不是原子操作；失败项可重跑。

## 5. 升级

1. 阅读 `CHANGELOG.md` 与相关 ADR。
2. 备份数据库与对象存储。
3. 滚动更新 control-plane（无状态）。
4. 更新 runner；在途任务会继续使用旧工作区。
5. 迁移只在启动时前进，回滚使用补偿迁移。

## 6. 移动端

```sh
cd apps/mobile
flutter build apk --dart-define=API_BASE=https://api.example.com
flutter build ios --dart-define=API_BASE=https://api.example.com
```

Android/iOS 签名、Firebase/APNs 推送需要各自的发布证书与项目配置。
