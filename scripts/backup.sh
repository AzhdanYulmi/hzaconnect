#!/usr/bin/env bash
# Casino-side backup of hzaconnect data:
#   - Postgres: pg_dump (custom format, gzipped)
#   - MinIO: mc mirror of the attachments bucket
#
# Output goes under $BACKUP_DIR (default: ./backups).
# Suitable for a daily cron entry:
#   0 3 * * *  cd /opt/hzaconnect && ./scripts/backup.sh >> /var/log/hzaconnect-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run from the repo root after configuring deployment." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TS=$(date -u +"%Y%m%dT%H%M%SZ")
mkdir -p "$BACKUP_DIR/$TS"

echo "==> Postgres dump"
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "$BACKUP_DIR/$TS/postgres.dump"

echo "==> MinIO mirror"
# Use a one-shot mc container so we don't depend on host tooling.
docker run --rm --network "${COMPOSE_PROJECT_NAME:-hzaconnect}_default" \
  -v "$PWD/$BACKUP_DIR/$TS:/out" \
  --entrypoint sh \
  minio/mc:latest -c "
    mc alias set local http://minio:9000 '$S3_ACCESS_KEY' '$S3_SECRET_KEY' >/dev/null
    mc mirror --overwrite --remove local/$S3_BUCKET /out/minio
  "

echo "==> Summary"
du -sh "$BACKUP_DIR/$TS"/*
echo "Backup complete: $BACKUP_DIR/$TS"

# Optional retention: keep last 14 days, prune older.
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
