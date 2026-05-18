#!/usr/bin/env bash
# Pull a new release, run pending migrations, recreate api + edge.
#
#   ./update.sh                 # update to whatever HZA_VERSION says in .env (usually 'latest')
#   ./update.sh --version v1.2.3   # pin to an explicit version
#
# Postgres/Redis/MinIO are left alone — their images rarely change and recreating
# them on every update is unnecessary churn.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--version TAG]
EOF
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

[ -f .env ] || { echo "ERROR: .env not found. Run install.sh first." >&2; exit 1; }

if [ -n "$VERSION" ]; then
  # update HZA_VERSION in .env in-place
  if grep -q '^HZA_VERSION=' .env; then
    sed -i.bak "s|^HZA_VERSION=.*|HZA_VERSION=${VERSION}|" .env && rm -f .env.bak
  else
    echo "HZA_VERSION=${VERSION}" >> .env
  fi
  echo "==> Pinned HZA_VERSION=${VERSION}"
fi

COMPOSE="docker compose --env-file ./.env -f ./docker-compose.deploy.yml"

echo "==> Pulling latest images"
$COMPOSE pull api edge

echo "==> Applying pending migrations"
$COMPOSE run --rm api node apps/api/dist/db/migrate.js

echo "==> Recreating api + edge"
$COMPOSE up -d --force-recreate api edge

echo "==> Waiting for api /health"
for i in $(seq 1 30); do
  if $COMPOSE exec -T api node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "==> API healthy"
    break
  fi
  [ "$i" = "30" ] && { echo "ERROR: API did not respond. Check logs: $COMPOSE logs api" >&2; exit 1; }
  sleep 2
done

DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2-)
echo "==> Update complete. Dashboard: https://${DOMAIN}/dashboard/"
