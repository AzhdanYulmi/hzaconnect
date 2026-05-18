# hzaconnect

Standalone support chat for casino websites. Single-tenant, self-deployed via Docker Compose. Phase 1 delivers:

- Embeddable widget (single `<script>` tag, Shadow DOM + iframe isolation)
- Agent + supervisor dashboard
- Real-time bidirectional messaging with ack'd delivery and resume-on-reconnect
- Anonymous sessions stable across page navigation and refresh
- Image attachments (png/jpeg/webp/gif, 5 MB max)
- Typing indicators, read receipts, manual queue claim, supervisor observation
- Append-only message + audit log, ready for future retention/compliance work

## Deploying (casino ops)

Prerequisites: Docker + Docker Compose.

```bash
git clone <repo> hzaconnect && cd hzaconnect
cp .env.example .env
# Edit .env — fill every value. Generate secrets with:
#   openssl rand -base64 48
chmod +x scripts/bootstrap.sh
docker compose up -d postgres redis minio
bash scripts/bootstrap.sh
docker compose up -d
```

When it's up:
- Dashboard: `${PUBLIC_ORIGIN}/dashboard/`
- Widget loader: `${PUBLIC_ORIGIN}/widget.js`

Add this to the casino site:

```html
<script src="https://chat.your-casino.com/widget.js" async></script>
```

The widget uses `localStorage` on the host origin to persist the anonymous session ID and refreshes its signed session token silently every page load.

### Host page API (available on `window.hzaconnect`)
- `hzaconnect.open()` / `close()` / `toggle()`
- `hzaconnect.setContext({ page: "...", game: "...", locale: "..." })` — forwarded to the server at session create
- `hzaconnect.identify(ssoToken)` — Phase 2 stub for signed-identity upgrade (casino JWT). No-op in Phase 1.

## Development

```bash
pnpm install
# Bring up infra only
docker compose up -d postgres redis minio
cd apps/api && pnpm db:migrate && pnpm db:seed && pnpm dev
# In separate terminals:
cd apps/dashboard && pnpm dev        # → http://localhost:5173
cd apps/widget    && pnpm dev        # → http://localhost:5174/frame.html
```

A host-page fixture for manual widget testing lives at `fixtures/host.html`. Open it with the dev stack running after `pnpm --filter @hzaconnect/widget build` (for `widget.js`) + nginx pointing at the built assets.

## Architecture at a glance

```
casino page ──> widget.js (shadow DOM launcher)
                    │ (click open)
                    ▼
               iframe (frame.html, chat origin)
                    │ WebSocket  /ws/widget
                    ▼
             Fastify + Socket.IO ─── Postgres  (conversations, messages, audit)
                    │                ─── Redis (typing, rate limiting)
                    │                ─── MinIO (image attachments)
                    ▲
                    │ WebSocket  /ws/agent
                    │
         React dashboard (agents, supervisors, admins)
```

Key invariants:
- Messages insert transactionally with `UNIQUE (conversation_id, client_message_id)` → idempotent retries.
- Per-conversation `seq` is monotonic under concurrent inserts (row-level lock on the conversation).
- Typing is ephemeral (Redis, 6 s TTL) — never persisted.
- `messages` and `audit_log` are append-only (trigger rejects UPDATE/DELETE).
- Every auth/conversation lifecycle event is recorded in `audit_log`.

## Paths worth knowing

- `packages/shared/src/events.ts` — single source of truth for all WS event schemas.
- `apps/api/src/realtime/conversation-service.ts` — message idempotency + seq monotonicity live here.
- `apps/api/src/realtime/io.ts` — Socket.IO namespaces, rooms, event handlers.
- `apps/api/src/db/schema.ts` — Drizzle schema with the uniqueness constraints enforcing the above.
- `apps/api/src/auth/can.ts` — single authorization decision point.
- `apps/widget/src/loader.ts` — IIFE loader; shadow DOM launcher + iframe injection + postMessage protocol.
- `apps/widget/src/frame/Frame.tsx` — iframe chat panel.
- `deploy/nginx.conf` — reverse proxy + static assets.
- `docker-compose.yml` — the single artifact a casino operator runs.

## What's explicitly NOT in Phase 1

SSO/signed-identity (schema + endpoint shape designed only), outbound webhooks to the casino, auto-routing / round-robin, canned responses, offline flow / leave-a-message, non-image attachments, AI features, i18n, multi-tenant, horizontal scaling (Redis adapter installed but not exercised), compliance export UIs, PII redaction/retention automation, E2E encryption, AV scanning, tags/notes/CRM, SLA timers, CSAT, analytics, per-casino theming, HA for Postgres/Redis/MinIO.

## Backups

The repo ships a turnkey backup + restore pair at `scripts/backup.sh` and `scripts/restore.sh`. They handle both Postgres (custom-format `pg_dump`) and MinIO (`mc mirror`) and write into `./backups/<UTC-timestamp>/`.

### Daily cron

```cron
0 3 * * *  cd /opt/hzaconnect && ./scripts/backup.sh >> /var/log/hzaconnect-backup.log 2>&1
```

`BACKUP_KEEP_DAYS` (default 14) controls retention — directories older than that are pruned automatically.

### Restore

```bash
./scripts/restore.sh ./backups/20260426T030000Z
```

The restore script will:
- prompt to confirm the destination DB name (typed match required)
- stop the API container so no writes happen during the operation
- drop and recreate the Postgres database, then `pg_restore`
- mirror the MinIO bucket back from the backup directory
- restart the API

Message history and audit log are append-only at the application layer; daily backups give you point-in-time recovery while staying simple to operate.

## Maintenance

Two cleanup actions are available both as CLI (cron-friendly) and from the dashboard's **Admin → Maintenance** tab:

```bash
# Close any non-closed conversation idle for >24h (default).
pnpm --filter @hzaconnect/api maintenance close-stale --hours 24

# Delete anonymous orphan sessions older than 30 days.
pnpm --filter @hzaconnect/api maintenance prune-sessions --days 30
```

Both actions write an `audit_log` entry. Sessions with an `external_user_id` (SSO upgrades) are never pruned automatically.
