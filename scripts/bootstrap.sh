#!/usr/bin/env bash
# One-shot bootstrap: run migrations, seed admin, build frontends.
# Run after the first `docker compose up -d`.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo ".env not found. Copy .env.example to .env and fill values first." >&2
  exit 1
fi

echo "==> Building dashboard + widget static bundles into volumes"
docker compose build dashboard-build widget-build
docker compose run --rm dashboard-build sh -c "cp -r /app/apps/dashboard/dist/* /out/"
docker compose run --rm widget-build sh -c "cp -r /app/apps/widget/dist/* /out/"

echo "==> Running database migrations"
docker compose run --rm api sh -c "node apps/api/dist/db/migrate.js"

echo "==> Seeding bootstrap admin"
docker compose run --rm api sh -c "node apps/api/dist/db/seed.js"

echo "==> Restarting API to pick up fresh state"
docker compose up -d api nginx

echo "Bootstrap complete."
echo "Dashboard: \$PUBLIC_ORIGIN/dashboard/"
echo "Widget script tag: <script src=\"\$PUBLIC_ORIGIN/widget.js\" async></script>"
