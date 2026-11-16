#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?需要 DATABASE_URL}"
: "${STORAGE_DIR:?需要 STORAGE_DIR}"
: "${BACKUP_DIR:?需要 BACKUP_DIR（包含 db.dump 与 storage.tar.gz）}"

if [ "${1:-}" != "--yes" ]; then
  echo "该操作会覆盖数据库与存储。确认后执行：BACKUP_DIR=... $0 --yes"
  exit 1
fi

pg_restore "$DATABASE_URL" --clean --if-exists --no-owner "$BACKUP_DIR/db.dump"
tar -C "$(dirname "$STORAGE_DIR")" -xzf "$BACKUP_DIR/storage.tar.gz"
echo "恢复完成：$BACKUP_DIR"
