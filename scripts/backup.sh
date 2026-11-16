#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?需要 DATABASE_URL}"
: "${STORAGE_DIR:?需要 STORAGE_DIR}"
OUT_DIR="${OUT_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$OUT_DIR/clouddeck-$STAMP"

mkdir -p "$TARGET"
pg_dump "$DATABASE_URL" --format=custom --file="$TARGET/db.dump"
tar -C "$(dirname "$STORAGE_DIR")" -czf "$TARGET/storage.tar.gz" "$(basename "$STORAGE_DIR")"
sha256sum "$TARGET/db.dump" "$TARGET/storage.tar.gz" > "$TARGET/SHA256SUMS" 2>/dev/null \
  || shasum -a 256 "$TARGET/db.dump" "$TARGET/storage.tar.gz" > "$TARGET/SHA256SUMS"

echo "备份完成：$TARGET"
