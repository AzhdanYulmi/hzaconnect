#!/usr/bin/env bash
# Restore a previously created backup directory.
#   ./scripts/restore.sh ./backups/20260426T030000Z
#
# WARNING: drops and recreates the database. Confirm before running on prod.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <backup-dir>" >&2
  exit 2
fi
BACKUP_DIR="$1"
if [ ! -f "$BACKUP_DIR/postgres.dump" ]; then
  echo "ERROR: $BACKUP_DIR/postgres.dump not found" >&2
  exit 1
fi
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

read -r -p "About to drop and recreate database '$POSTGRES_DB'. Type the DB name to confirm: " CONFIRM
if [ "$CONFIRM" != "$POSTGRES_DB" ]; then
  echo "Aborted."
  exit 1
fi

echo "==> Stopping API to avoid live writes during restore"
docker compose stop api

echo "==> Dropping and recreating Postgres database"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres <<SQL
DROP DATABASE IF EXISTS "$POSTGRES_DB";
CREATE DATABASE "$POSTGRES_DB";
SQL

echo "==> Restoring Postgres"
docker compose exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists \
  < "$BACKUP_DIR/postgres.dump"

if [ -d "$BACKUP_DIR/minio" ]; then
  echo "==> Restoring MinIO"
  docker run --rm --network "${COMPOSE_PROJECT_NAME:-hzaconnect}_default" \
    -v "$PWD/$BACKUP_DIR/minio:/in" \
    --entrypoint sh \
    minio/mc:latest -c "
      mc alias set local http://minio:9000 '$S3_ACCESS_KEY' '$S3_SECRET_KEY' >/dev/null
      mc mb -p local/$S3_BUCKET || true
      mc mirror --overwrite --remove /in local/$S3_BUCKET
    "
fi

echo "==> Restarting API"
docker compose up -d api

echo "Restore complete from $BACKUP_DIR"
