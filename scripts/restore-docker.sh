#!/usr/bin/env sh
set -eu
if [ "${1:-}" != "--yes" ]; then
  echo "会覆盖 Postgres 与存储卷。确认后执行：BACKUP_DIR=... $0 --yes"
  exit 1
fi
: "${BACKUP_DIR:?需要 BACKUP_DIR}"
PG_CONTAINER="${PG_CONTAINER:-clouddeck-postgres-1}"
STORAGE_VOLUME="${STORAGE_VOLUME:-clouddeck_storage}"

docker cp "$BACKUP_DIR/db.dump" "$PG_CONTAINER:/tmp/clouddeck-restore.dump"
docker exec "$PG_CONTAINER" pg_restore -U clouddeck -d clouddeck --clean --if-exists --no-owner /tmp/clouddeck-restore.dump
docker run --rm -v "$STORAGE_VOLUME":/data -v "$(pwd)/$BACKUP_DIR":/backup node:22-alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/storage.tar.gz -C /data'
echo "恢复完成：$BACKUP_DIR"
