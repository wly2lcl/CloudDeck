#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL required}"
: "${STORAGE_DIR:?STORAGE_DIR required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/$STAMP"
mkdir -p "$TARGET"

pg_dump "$DATABASE_URL" --format=custom --file="$TARGET/db.dump"
tar -czf "$TARGET/storage.tar.gz" -C "$STORAGE_DIR" .
( cd "$TARGET" && sha256sum db.dump storage.tar.gz > SHA256SUMS 2>/dev/null || shasum -a 256 db.dump storage.tar.gz > SHA256SUMS )
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +
echo "backup ok: $TARGET"
