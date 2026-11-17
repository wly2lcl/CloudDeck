#!/usr/bin/env sh
set -eu
PG_CONTAINER="${PG_CONTAINER:-clouddeck-postgres-1}"
STORAGE_VOLUME="${STORAGE_VOLUME:-clouddeck_storage}"
OUT_DIR="${OUT_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$OUT_DIR/clouddeck-$STAMP"
mkdir -p "$TARGET"

docker exec "$PG_CONTAINER" pg_dump -U clouddeck -d clouddeck -Fc -f /tmp/clouddeck.dump
docker cp "$PG_CONTAINER:/tmp/clouddeck.dump" "$TARGET/db.dump"
docker run --rm -v "$STORAGE_VOLUME":/data:ro -v "$(pwd)/$TARGET":/backup node:22-alpine \
  tar czf /backup/storage.tar.gz -C /data .
shasum -a 256 "$TARGET/db.dump" "$TARGET/storage.tar.gz" > "$TARGET/SHA256SUMS"
echo "备份完成：$TARGET"
