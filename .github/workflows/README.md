# CI

`ci.yml` runs on every push and PR. Three jobs:

1. **static** — `pnpm install` + typecheck across all packages + Vitest unit tests.
2. **e2e-dev** — boots `postgres/redis/minio` via compose, runs API and dashboard from sources, executes the Playwright suite against `localhost:5173`.
3. **e2e-prod** — builds Docker images for api/dashboard/widget, brings up the full compose stack with nginx on `localhost:8080`, runs the same Playwright suite through nginx. This catches packaging regressions (Dockerfiles, multi-stage builds, nginx config, S3 endpoint signing, volume mounts) that the dev workflow hides.

Both e2e jobs upload Playwright reports + container logs as artifacts on failure.

## Why two e2e jobs?

The dev stack uses `tsx` and Vite dev server — fast feedback when implementation changes break runtime. The prod stack uses compiled JS, multi-stage Docker builds, and nginx — fast feedback when packaging or deploy config breaks. Either job alone misses failures the other catches.

## Local equivalents

```bash
# dev stack
docker compose up -d postgres redis minio
pnpm --filter @hzaconnect/api db:generate
pnpm --filter @hzaconnect/api db:migrate
pnpm --filter @hzaconnect/api db:seed
pnpm --filter @hzaconnect/widget build
pnpm --filter @hzaconnect/api dev &
pnpm --filter @hzaconnect/dashboard dev &
pnpm --filter @hzaconnect/e2e exec playwright test

# prod stack
docker compose build
docker compose up -d
docker compose -f docker-compose.yml -f docker-compose.dev-fixtures.yml up -d nginx
HZA_API_BASE=http://localhost:8080 \
HZA_DASHBOARD_BASE=http://localhost:8080/dashboard/ \
  pnpm --filter @hzaconnect/e2e exec playwright test
```
