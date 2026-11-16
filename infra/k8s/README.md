# Kubernetes 部署

面向生产的清单，默认假设：

- PostgreSQL 使用外部托管实例（`DATABASE_URL`）。
- 对象存储使用 S3/MinIO（`S3_*`），因此控制面与 runner 不需要共享本地存储。
  如需本地存储，`clouddeck-storage` PVC 需支持 `ReadWriteMany`。
- Ingress 使用 nginx，Web 与 API 分属两个域名。

## 构建 Web 镜像

`NEXT_PUBLIC_API_BASE` 在构建时注入。发布版镜像默认指向 `http://localhost:4310`，
Kubernetes 部署需要以你的 API 域名重新构建：

```sh
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_BASE=https://api.clouddeck.example.com \
  -t registry.example.com/clouddeck/web:0.1.2 .
docker push registry.example.com/clouddeck/web:0.1.2
```

然后修改 `web.yaml` 的镜像地址。

## 部署

```sh
kubectl create namespace clouddeck
kubectl -n clouddeck create secret generic clouddeck-secrets \
  --from-literal=DATABASE_URL='postgres://...' \
  --from-literal=AUTH_SECRET='...' \
  --from-literal=CREDENTIALS_KEY='...' \
  --from-literal=STORAGE_LOCAL_SECRET='...' \
  --from-literal=PAYMENT_SECRET='...' \
  --from-literal=S3_ENDPOINT='...' \
  --from-literal=S3_REGION='us-east-1' \
  --from-literal=S3_BUCKET='clouddeck' \
  --from-literal=S3_ACCESS_KEY='...' \
  --from-literal=S3_SECRET_KEY='...'

kubectl apply -k infra/k8s
```

修改 `configmap.yaml` 中的域名后再应用。

## 注意事项

- `job-runner` 默认 `SANDBOX_DRIVER=docker`；生产建议安装 gVisor 并设置
  `SANDBOX_RUNTIME=runsc`，同时给 runner 节点加污点隔离。
- 控制面副本数保持 1，避免迁移并发；需要横向扩展时先拆出迁移 Job。
- runner 使用 PostgreSQL `SKIP LOCKED` 队列，可安全增加副本；每副本并发由
  `WORKER_CONCURRENCY` 控制。
- `clouddeck-storage`/`clouddeck-workspaces` 若用 S3 可删除对应 volume。
