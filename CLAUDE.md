# CLAUDE.md — hzaconnect project primer

> This file is a context primer for AI coding assistants (and any new contributor).
> If you're starting a fresh chat, **read this end-to-end before touching anything**.
> Updated: post Phase-1 + post-polish + licensing live.

---

## TL;DR

**What this is**: a standalone, embeddable support-chat product for casino websites.
Self-deployed by the casino (one casino = one deployment). Anonymous players hit a
JS widget on the casino's site → support agents handle conversations in a separate
React dashboard. The product is sold by a vendor (the repo owner) who hosts a
**license server** that controls each customer's right to operate.

**Stack**: Node 22 + TypeScript everywhere. Fastify + Socket.IO for the API.
React + Vite for the dashboard. Preact + Vite for the widget. Postgres + Drizzle.
Redis for ephemeral state. MinIO (S3-compatible) for image attachments.
Caddy fronting the vendor's license-server VPS. Docker Compose for deployment.

**Status**: Phase 1 functional, polished UI/UX, anonymous identification, tags,
push notifications, full licensing kill-switch, i18n (English + Turkish). Live
license server on a Contabo VPS at `https://144-91-84-61.nip.io`. Currently testing
the cross-machine licensing flow with a friend deployment on Windows.

---

## Quick start (most common commands)

```bash
# --- dev workflow on the laptop ---
docker compose up -d postgres redis minio        # infrastructure
pnpm install                                     # also runs `prepare` → builds shared/dist
pnpm --filter @hzaconnect/api db:migrate         # migrations
pnpm --filter @hzaconnect/api db:seed            # bootstrap admin from .env
pnpm --filter @hzaconnect/api dev                # API on :3000
pnpm --filter @hzaconnect/dashboard dev          # dashboard on :5173
pnpm --filter @hzaconnect/widget build           # widget bundle (loader + iframe)

# --- tests ---
pnpm -r typecheck                                # all packages
pnpm --filter @hzaconnect/api test               # 6 unit tests (can() matrix)
pnpm --filter @hzaconnect/license test           # 5 unit tests (Ed25519)
pnpm --filter @hzaconnect/e2e exec playwright test  # 78 e2e tests, chromium + webkit

# --- license server (vendor side) ---
pnpm --filter @hzaconnect/license-server dev     # local on :4400
pnpm --filter @hzaconnect/license-server issue issue --name "X" --days 30
pnpm --filter @hzaconnect/license-server issue list

# --- production casino-side stack (the LEGACY build-from-source path, used by CI e2e-prod) ---
docker compose build api dashboard-build widget-build
docker compose up -d                             # postgres/redis/minio/api
docker compose exec -T api node apps/api/dist/db/migrate.js
docker compose exec -T api node apps/api/dist/db/seed.js
docker compose -f docker-compose.yml -f docker-compose.dev-fixtures.yml up -d nginx
# entrypoint: http://localhost:8080

# --- production casino-side stack (the NEW "easy deploy" path that customers use) ---
# One-liner on a fresh server (Docker already installed). Source repo is public.
curl -fsSL https://raw.githubusercontent.com/AzhdanYulmi/hzaconnect/main/deploy/install/bootstrap.sh | sudo bash -s -- \
  --domain chat.acme.com --token <LICENSE> --admin-email me@acme.com
# Subsequent ops (after /usr/local/bin/hzaconnect is linked):
hzaconnect status      # service + license health
hzaconnect doctor      # full diagnostic (env, license server, containers, external)
hzaconnect update      # pull new images + migrate + recreate
hzaconnect logs api    # tail api logs
hzaconnect backup      # snapshot postgres + minio

# --- production license-server deploy on a VPS ---
bash scripts/deploy-license-server.sh <domain> <acme-email>
# (e.g. licenses.yourbrand.com you@yourbrand.com)
```

Bootstrap admin creds are pulled from `.env` (`BOOTSTRAP_ADMIN_EMAIL`/`_PASSWORD`).

---

## Architecture

Two distinct deployments:

### A. Casino-side stack (what each customer runs)

```
  player's browser
       │
       │  https://chat.<casino>.com/widget.js   (loader, ~3 KB gz)
       │  injects iframe → https://.../widget/frame.html
       ▼
  edge (Caddy, auto-TLS)
       ──┬── /              → /dashboard/ (redirect)
         ├── /dashboard/    → React SPA (baked into edge image)
         ├── /widget.js     → IIFE loader (baked into edge image)
         ├── /widget/*      → iframe bundle + assets (baked into edge image)
         ├── /api/*         → Fastify API
         └── /ws            → Socket.IO

  Fastify API ── Postgres   (conversations, messages, audit log)
              ── Redis      (typing indicators, presence, rate limit)
              ── MinIO      (image attachments, presigned URLs)
              ── heartbeat → vendor's license server (every 30 min)
```

**Two deployment paths exist for the casino-side stack:**

- **NEW (`deploy/install/`) — the "easy deploy" path that customers actually use.**
  Two pre-built Docker images pulled from GHCR: `hzaconnect-api` and
  `hzaconnect-edge` (Caddy with dashboard + widget static files baked in).
  Customer runs one bootstrap command → `install.sh` generates secrets, fetches
  the vendor's public key from the license server, writes `.env`, migrates,
  starts the stack. Updates are `hzaconnect update` (pull + migrate + recreate).
  TLS is auto-provisioned by Caddy via Let's Encrypt.

- **LEGACY (`docker-compose.yml` at repo root) — the build-from-source path,
  kept for the CI `e2e-prod` job and development.** Builds images from source
  on the host, separate `dashboard-build` + `widget-build` services populate
  volumes mounted into nginx. Don't ship this model to customers — the new
  path is strictly better. The legacy compose is still source-of-truth for
  what the api expects; any new env var must land in both.

Players are anonymous by default. The widget mounts a launcher in a **closed
Shadow Root** on the host page (no CSS/JS pollution), and on open injects an
**iframe** served from the chat origin (full process isolation from the casino
site). Communication between host and iframe via `postMessage` with strict
origin checks.

Agents log into the dashboard at `/dashboard/`. Authentication is email +
password (Argon2id) returning a short-lived JWT + httpOnly refresh cookie with
rotation.

### B. Vendor-side license server (single instance, runs on a VPS)

```
  https://licenses.<vendor>.com  ←─ heartbeats from every casino deployment
       │
  Caddy (auto-TLS via Let's Encrypt) → license-server:4400 (Fastify + SQLite)
       │
  Admin UI (HTTP basic auth)  → /admin (server-rendered HTML, no React build)
```

The license server issues Ed25519-signed license tokens. The casino API verifies
the signature **offline** at boot (cryptographic), then heartbeats every 30
minutes for an **authorization** check (online — the vendor can suspend at any
time and within one heartbeat cycle the casino's chat hard-blocks).

---

## Repo layout

```
hzaconnect/
├── apps/
│   ├── api/                  # Fastify + Socket.IO + Drizzle (the casino's chat API)
│   ├── dashboard/            # React + Vite + Zustand (the agent UI)
│   ├── widget/               # Preact + Vite (loader IIFE + iframe panel)
│   ├── license-server/       # Fastify + SQLite + better-sqlite3 (vendor's only service)
│   └── e2e/                  # Playwright (chromium + webkit)
├── packages/
│   ├── shared/               # Zod event/domain schemas — used by api + dashboard + widget
│   └── license/              # Ed25519 sign/verify — used by api + license-server
├── deploy/
│   ├── install/                  # casino-side easy-deploy bundle (the customer-facing path)
│   │   ├── bootstrap.sh          # curl|bash one-liner — downloads bundle, runs install.sh
│   │   ├── install.sh            # interactive installer, generates secrets, fetches public key
│   │   ├── update.sh             # pull new images + migrate + recreate
│   │   ├── doctor.sh             # robust diagnostic (env / license / containers / external)
│   │   ├── hzaconnect            # ops CLI (status/logs/start/stop/backup/restore/embed/...)
│   │   ├── Caddyfile             # baked into edge image; replaces nginx routes
│   │   ├── docker-compose.deploy.yml  # pre-built images, NO build: keys
│   │   ├── edge.Dockerfile       # Caddy + built dashboard/widget — pushed to GHCR by release.yml
│   │   └── .env.example          # documentation only; install.sh writes the real .env
│   ├── nginx.conf            # legacy casino-side nginx (CI e2e-prod still uses it)
│   ├── nginx.dev-fixtures.conf  # dev/CI overlay (serves /dev/host.html)
│   ├── Caddyfile.license     # vendor's TLS reverse proxy in front of license-server
│   └── .env.license          # ${LICENSE_DOMAIN}/${ACME_EMAIL} for the compose
├── scripts/
│   ├── deploy-license-server.sh  # one-shot fresh-VPS bootstrap
│   ├── backup.sh / restore.sh    # casino-side Postgres + MinIO backup
│   └── bootstrap.sh              # not used in current workflow
├── docs/licensing.md         # vendor-facing operations runbook
├── fixtures/host.html        # demo "casino" page that loads /widget.js (dev/CI only)
├── docker-compose.yml                       # main casino-side stack
├── docker-compose.dev-fixtures.yml          # overlay: mounts fixtures/ into nginx
├── docker-compose.license-test.yml          # overlay: licenses the LOCAL prod stack for testing
├── docker-compose.license.yml               # vendor-side: license-server + Caddy
└── .env.example              # one .env shape; casino uses the casino-stack fields,
                              # vendor uses the licensing fields, license-server uses
                              # apps/license-server/.env
```

---

## Design decisions (the *why*)

**Anonymous-by-default identity, not SSO.** The buyer's stated requirement.
Players provide their own ID/email/phone as structured identifiers (see
`session_identifiers` table). SSO endpoint shape is reserved
(`/api/widget/session/upgrade`) but not implemented. See
[Anonymous identification](#anonymous-identification) below.

**Single-tenant.** One casino = one deployment = one Postgres = one MinIO.
Multi-tenant would be a major schema/architecture change and was scoped out.

**Widget isolation: Shadow DOM + iframe hybrid.** Launcher lives in a closed
Shadow Root on the host page (tiny, no CSS bleed). On open, an iframe is
injected from the chat origin → the heavy chat panel runs in a fully isolated
document with its own cookies/storage/CSP. This is what Intercom/Crisp/Front
all converge on.

**Append-only messages and audit log.** A Postgres trigger rejects UPDATE/DELETE
on `audit_log` and `messages`. Compliance posture for casinos. Redactions use
a `redacted_at` column (content nulled, row preserved).

**Idempotent message sends.** Every message has a `client_message_id` UUID set
by the client; the server's `(conversation_id, client_message_id)` UNIQUE
index makes retries idempotent. The same row is returned on duplicate sends.

**Monotonic per-conversation `seq`.** Sequence assigned inside a `FOR UPDATE`
row lock on the conversation, so 50 parallel sends produce seqs 1..50 with no
gaps and no duplicates. This is what makes `conversation.resume(last_seen_seq)`
correct — the server returns exactly the missed window.

**Typing indicators are ephemeral.** Stored in Redis with 6 s TTL, never written
to `messages` or `audit_log`. Auto `typing.stop` after 3 s idle.

**Real-time gateway is Socket.IO with two namespaces.** `/widget` for players,
`/agent` for support staff. Each socket joins `conversation:<id>` rooms;
broadcasts are scoped per room. Both namespaces' middleware reads the in-memory
license state and refuses new connects when license is suspended.

**Licensing model: signed token + heartbeat.** Tokens are Ed25519-signed with a
30-day expiry by default. The casino's API verifies the signature offline at
boot, then heartbeats every 30 min to the vendor's license server. If the
heartbeat says "suspended", the API **immediately disconnects all open
WebSockets** and starts refusing new requests with 503. Reverting is a single
admin click. No bypass without forking the code and replacing the public key
embedded via env.

**Light-themed dashboard.** Matches the widget's design system (indigo brand,
slate text, soft surfaces). Reasoning: agents work long shifts and the entire
modern support-tool category (Intercom, Front, Zendesk, Help Scout) is light.

**Internationalisation built in from polish phase.** `react-i18next` in the
dashboard (~12 KB), a tiny custom 30-line i18n in the widget (keeps the
widget bundle small). English + Turkish out of the box.

---

## What's built

### Phase 1 — Real-time chat (everything works)

- Embeddable single-`<script>` widget with Shadow DOM + iframe isolation
- Agent dashboard with login, queue, conversation pane, claim, close, supervisor read-only
- WebSocket bidirectional messaging with `seq` monotonicity + idempotent `client_message_id`
- Reconnect-and-resume on disconnect / page refresh (cursor-based catch-up)
- Image attachments (PNG/JPEG/WEBP/GIF, 5 MB cap, S3 presigned URLs)
- Typing indicators, read receipts, unread badges
- Anonymous session persistence across page navigation (localStorage)

### Polish phase

- Cohesive design system (indigo brand, design tokens, motion easing) — widget AND dashboard
- Inline SVG icons throughout (no emoji)
- Refined launcher button with gradient + entry animations
- Iframe panel: animated typing dots, message fade-ins, sender-side check-mark read receipts
- Auto-sizing composer, attachment chips with dismiss
- Dashboard: real conversation-list rows with avatars + relative timestamps,
  empty states, focus rings, hover states, light theme
- Pre-chat card for anonymous identification (configurable)

### Anonymous identification

- New tables: `session_identifiers` (append-only with `superseded_at`),
  `deployment_settings` (singleton per deployment)
- Widget pre-chat card capturing player_id / email / phone / username / custom
- Configurable per-deployment from **Admin → Identification**
- Agent can add/correct identifiers in **Player info** panel
- Returning-player history: surfaces prior conversations with the same identifier
- `window.hzaconnect.setIdentifiers([...])` programmatic API

### Push notifications + tags

- Browser Notification API + Web Audio beep (no asset needed)
- Bell toggle in dashboard header, per-agent localStorage preference
- Tags: per-deployment library (`Admin → Tags`), apply/remove on a conversation,
  queue filter by tag, English + Turkish labels per tag

### Licensing kill-switch

- Vendor-side license server (`apps/license-server/`): SQLite + Fastify +
  basic-auth admin UI (server-rendered HTML)
- Casino-side API: verify-at-boot + heartbeat-every-30-min, in-memory state,
  on suspend → disconnect all WS + 503 on REST
- Dashboard banner ("Service suspended.") within 1-2 s of disconnect via custom
  WS-disconnect event
- Widget banner in red, composer locked
- Cross-machine tested: vendor at `https://144-91-84-61.nip.io`, casino's
  deployment on a different network → suspend takes effect within 30 s

### Easy-deploy installer (May 2026)

- `deploy/install/` bundle: customer runs one `curl|bash` and gets a working
  HTTPS chat in ~3 minutes
- Two pre-built images on GHCR (`hzaconnect-api`, `hzaconnect-edge`) — customer
  never builds from source, never sees source code
- `install.sh` generates strong secrets, fetches the vendor's public key from
  the license server (kills the chat-mangled-PEM bug class), writes `.env`,
  runs migrations + seed, brings up the stack, waits for TLS
- `hzaconnect` CLI: install / update / doctor / status / logs / restart /
  backup / restore / embed / shell / env / version / uninstall
- `hzaconnect doctor`: 4-scope diagnostic (env validity, license server
  reachability + key match + heartbeat state, container health + migrations
  + TLS cert on disk, external DNS + HTTPS reachability + widget CORS + cert
  expiry). Read-only, color-coded, with remediation hints on each fail
- `.github/workflows/release.yml`: on tag push, builds + pushes both images
  to GHCR (`ghcr.io/AzhdanYulmi/hzaconnect-{api,edge}`) and creates a tagged
  release in this repo with a deploy-bundle tarball + sha256
- Single public repo (`AzhdanYulmi/hzaconnect`) holds source + install bundle.
  Customers `curl | bash` the bootstrap script directly from the repo's main
  branch. Licensing kill-switch is what gates use — source visibility doesn't
  weaken it (the Ed25519 private key never leaves the vendor's VPS)
- The legacy `docker-compose.yml` + `deploy/nginx.conf` build-from-source
  path stays for CI; customers don't see it

### Operator polish

- Admin UI for: Agents (create/disable/role-change), Embed snippet (copy-paste
  for casino IT), Identification config, Tags library, Maintenance
  (close-stale-conversations, prune-orphan-sessions)
- License-server CLI: `issue issue --name X --days 30`, `issue list`,
  `keys:generate`, `onboard onboard ... --out file.pdf` (PDF onboarding doc)
- Daily backup script (`scripts/backup.sh`) + restore script

### Test coverage

- 11 unit tests (Ed25519 sign/verify, `can()` authorization matrix)
- 78 Playwright e2e tests across Chromium + WebKit:
  - Embed isolation (3)
  - Happy path bidirectional + typing (2)
  - Resume on disconnect/refresh (3)
  - Two-agent claim race (2)
  - Supervisor read-only (1)
  - Image attachments (4)
  - Admin agents + embed + maintenance (6)
  - i18n (2)
  - Anonymous identification (5)
  - Push notifications (2)
  - Tags (3)
  - Licensing (5)
- GitHub Actions CI workflow (`.github/workflows/ci.yml`): static + e2e-dev + e2e-prod

---

## What's NOT built (deferred — designed only or not started)

- **SSO / signed-identity from the casino**. Schema + endpoint shape designed
  (`session_identifiers.source = 'sso'`, `POST /api/widget/session/upgrade`),
  not implemented. Buyer explicitly opted out.
- **Outbound webhooks** to the casino's CRM/ops tooling (chat.opened, chat.resolved, etc.).
- **Auto-routing / round-robin / skill-based**. Manual queue claim only.
- **Canned responses / macros / quick replies**.
- **Offline / leave-a-message flow** when no agents online.
- **Non-image attachments** (PDF, video). Currently images only, 5 MB max.
- **AI features** (summaries, suggested replies, chatbot).
- **Mobile-native widget** — only web. The widget is responsive but the
  panel is fixed 380 px on desktop; mobile goes fullscreen.
- **Multi-tenant**. Single-tenant only by design.
- **Horizontal scaling**. Redis adapter installed but not exercised at scale.
- **HA Postgres / Redis / MinIO**. Single-node. Casino does nightly `pg_dump`.
- **Compliance export UIs / automated retention scheduling**. Schema supports
  it (redacted_at, audit_log), no UI.
- **AV scanning of uploads**. Schema has `scan_status` enum hook.
- **End-to-end encryption** of message bodies.
- **CSAT / SLA timers / analytics dashboards**.
- **Per-casino theming**. One neutral theme.

---

## Known gotchas (things that bit us, in order of pain)

### pnpm 9 + native deps

`pnpm 9` doesn't run install scripts for dependencies by default unless they're
in `pnpm.onlyBuiltDependencies`. Combined with `--ignore-scripts` (which we use
in Dockerfiles to skip workspace `prepare` hooks), this means **better-sqlite3
never compiles its native binding** unless we explicitly trigger it.

Current fix in `apps/license-server/Dockerfile`:
```Dockerfile
RUN pnpm install --frozen-lockfile=false --ignore-scripts
RUN BSQL_DIR=$(ls -d /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3) && \
    cd "$BSQL_DIR" && \
    npm run install && \
    ls -la build/Release/better_sqlite3.node
```

### `@hzaconnect/shared` needs to be built before consumers

Its `package.json` has `main: ./dist/index.js`. Vite (in dashboard/widget builds)
fails with `Failed to resolve entry for package "@hzaconnect/shared"` if `dist/`
doesn't exist yet. The `prepare` script builds it; `--ignore-scripts` skips
that. Dockerfiles must include `RUN pnpm --filter @hzaconnect/shared build`
before the consumer's build.

### Windows .env line endings and multi-line values

Multi-line values in `.env` (e.g. `LICENSE_PUBLIC_KEY_PEM` as a PEM block) work
only on Docker Compose ≥ 2.18. Even then, CRLF line endings inject `\r` into
the value, and some shells/editors leave the outer `"` quotes embedded in the
final value. The license verifier in `apps/api/src/license/verify.ts` defuses
all three:
```ts
config.LICENSE_PUBLIC_KEY_PEM
  .replace(/\r/g, "")          // strip CRLF
  .trim()
  .replace(/^["']|["']$/g, "")  // strip leftover quotes
  .trim()
```

The robust alternative is **`LICENSE_PUBLIC_KEY_PATH`** pointing at a mounted
file. Both are supported.

### Path math — repo root is `../../..` not `../../../..`

From `apps/api/src/license/verify.ts` (4 levels deep) → repo root = `../../../..`.
From `apps/license-server/src/config.ts` (3 levels) → repo root = `../../..`.
From `apps/api/src/server.ts` (3 levels) → repo root = `../../..`.

I've gotten this wrong twice in this codebase. Count `URL(...).pathname`
levels carefully: each `..` walks up from the *directory containing the file*.

### `host.docker.internal` on Linux Docker

Docker Desktop (Mac/Windows) resolves `host.docker.internal` automatically.
Plain Linux Docker doesn't — needs `extra_hosts: ["host.docker.internal:host-gateway"]`
on the service. See `docker-compose.license-test.yml`.

### Workspace package symlinks vanish across Dockerfile stages

When you `COPY --from=build /app/node_modules ./node_modules` in the runtime
stage, pnpm's workspace-local `apps/<x>/node_modules` is **not** copied. Each
app workspace needs its own `COPY --from=build /app/apps/<x>/node_modules
./apps/<x>/node_modules` line. The api Dockerfile has this; new app Dockerfiles
need it too.

### `tsx watch` doesn't restart on `.env` changes

Only on source file changes. After editing `.env`, manually `pkill -f "tsx watch"`
and restart the dev API. Same applies to the license-server in dev.

### `pkill -f "tsx watch"` doesn't always work

Sometimes there are orphan Node processes from earlier sessions still bound to
port 3000. Diagnose with `lsof -nPi :3000 | grep LISTEN`, kill the specific
PID. (Hit this once when the dev API silently kept the old `.env` for hours.)

### The "Logout" button changed to icon-only

In `App.tsx`'s `ChatView` the logout is an `icon-btn` with `aria-label` only,
no visible "Logout" text. Tests use `getByRole("button", { name: /Logout/ })`
which picks up the aria-label. Don't switch back to `getByText`.

### Dashboard avatar shows `?` for anonymous players

This is intentional (no name shared yet). We now render a user-silhouette
icon instead of a literal `?`. See `ConversationList.tsx` and the `UserIcon`
import.

---

## Live infrastructure (as of latest session)

- **Vendor's VPS**: Contabo, IP `144.91.84.61`, Ubuntu 24.04 LTS, root SSH via Termius
- **License server URL**: `https://144-91-84-61.nip.io`
  - `/admin` — HTTP basic auth, customer management
  - `/heartbeat` — POST endpoint for casino deployments
  - `/public-key` — fetches the current public PEM (use this to send to customers)
- **No domain bought yet**. Using nip.io as a free DNS-resolvable hostname for
  Let's Encrypt cert. Migration to a real domain later is a one-env-var change.
- **Customers in license DB**: at last check — Acme Casino, Bellagio Test, Casino Royale,
  Sikish, Friend Test Casino (plus a "lixop" the friend created during test). All in
  `apps/license-server/data/license-server.db` on the VPS.

### Vendor admin credentials

Stored in `/opt/hzaconnect/apps/license-server/.env` on the VPS. Retrieve with:
```bash
ssh root@144.91.84.61 'grep ADMIN_PASSWORD /opt/hzaconnect/apps/license-server/.env'
```

### Public key

Anyone can fetch it: `curl https://144-91-84-61.nip.io/public-key`. Customers
need this to verify their license token offline at API boot.

---

## Operations

### Issue a new license for a customer

UI: `https://144-91-84-61.nip.io/admin` → fill the create form → click
**Create + issue license** → copy the token from the result page (only shown once).

CLI on the VPS:
```bash
cd /opt/hzaconnect
docker compose -f docker-compose.license.yml exec license-server \
  node apps/license-server/dist/cli/issue.js issue --name "Casino X" --days 30
```

### Suspend a paying-stopped customer

UI: open customer page → click **suspend**. Casino's deployment dies within
30 min (or 30 s in test config). Click **resume** to bring back.

### Revoke a leaked token

UI: customer page → click **revoke** on a specific license row. That token is
dead forever; the customer needs a new one if they continue.

### Casino-side daily backup

`scripts/backup.sh` dumps Postgres + mirrors MinIO into `./backups/<UTC-timestamp>/`.
Cron entry:
```
0 3 * * *  cd /opt/hzaconnect && ./scripts/backup.sh >> /var/log/hzaconnect-backup.log 2>&1
```

### Onboard a new casino customer

1. Issue license in vendor admin → copy token
2. Get public key from `https://144-91-84-61.nip.io/public-key`
3. Send to casino IT: token, public key (use code blocks in chat apps so dashes
   don't get stripped), and the license server URL
4. They paste into their `.env`, `docker compose up -d`, done

There's also a PDF generator: `pnpm --filter @hzaconnect/license-server onboard
onboard --name "Casino X" --days 30 --out ./casino-x` produces a polished
PDF/MD/env-snippet packet for emailing.

---

## Files by task

When working on...

| Task | Start with |
|---|---|
| New chat/realtime feature | `apps/api/src/realtime/io.ts`, `conversation-service.ts`, `packages/shared/src/events.ts` |
| Widget UI change | `apps/widget/src/loader.ts` (launcher), `apps/widget/src/frame/Frame.tsx` (panel) |
| Widget styles | `apps/widget/src/frame/styles.css` |
| Dashboard UI change | `apps/dashboard/src/App.tsx` (entry), components in same dir |
| Dashboard styles | `apps/dashboard/src/styles.css` (design system) |
| Auth / agent permissions | `apps/api/src/auth/can.ts`, `apps/api/src/routes/auth.ts` |
| DB schema | `apps/api/src/db/schema.ts`, then `pnpm db:generate` for migration |
| License logic | `apps/api/src/license/` (casino side), `apps/license-server/src/` (vendor) |
| Adding a new admin page | `apps/dashboard/src/Admin<X>.tsx` + register in `App.tsx`'s `AdminView` tabs |
| Adding a new test | `apps/e2e/tests/NN-name.spec.ts`, follow patterns in 01-12 |
| i18n strings | `apps/dashboard/src/i18n/en.json` + `tr.json`, `apps/widget/src/frame/i18n.ts` |
| Production deploy config (legacy / CI) | `docker-compose.yml`, `deploy/nginx.conf` |
| Customer easy-deploy | `deploy/install/*` — `install.sh`, `update.sh`, `doctor.sh`, `hzaconnect`, `Caddyfile`, `edge.Dockerfile`, `docker-compose.deploy.yml` |
| Release / image publish | `.github/workflows/release.yml` (build + push api/edge images to GHCR on tag) |
| Vendor VPS deploy | `scripts/deploy-license-server.sh`, `docker-compose.license.yml`, `deploy/Caddyfile.license` |

---

## How I (the AI assistant) should work in this codebase

Based on what's worked well so far:

- **Diagnostic-first when debugging.** Before applying fixes, get the actual
  state: container logs, env values, network reachability. Past me has burned
  cycles applying speculative fixes — don't do that.
- **Verify tests pass before declaring done.** Cross-browser (Chromium + WebKit)
  is mandatory. `pnpm exec playwright test` must be green.
- **Typecheck across the workspace.** `pnpm -r typecheck` must pass.
- **Keep dev workflow + production deploy in sync.** Bugs hide in the gap
  between "works in dev" and "works in Docker". The CI workflow's `e2e-prod`
  job exists for this reason.
- **The user is a builder, not a dev-ops specialist.** Give concrete commands,
  not just principles. Show the output you expect. When something fails,
  diagnose-first, then provide one specific next command — don't dump a flowchart.
- **Plan changes briefly before making them.** A 3-bullet plan is enough.
- **The plan files in `/Users/azhdanyulmi/.claude/plans/` are historical**;
  the canonical state is this repo + this CLAUDE.md.

### Style nits I've learned

- The user dislikes excessive emoji in responses. Stick to subheadings + tables.
- Code blocks should be runnable as-is. No `<paste here>` placeholders if the
  value is something I already know.
- When proposing a multi-step plan, **ask before doing destructive operations**
  (rm, force-recreate, dropping DBs). But cautious operations (read-only checks,
  builds) can just run.
- Don't restate the user's question back to them. Get into the answer.
- Reserve "**…**" emphasis for things that genuinely change interpretation.

---

## Last session's open thread

### Where things stand at handover (May 18, 2026)

- **Vendor's license server** at `https://144-91-84-61.nip.io` is live, healthy,
  TLS via Let's Encrypt. Admin password lives at
  `/opt/hzaconnect/apps/license-server/.env` on the Contabo VPS.
- **Friend test completed** — Windows 11 / Git Bash / Docker Desktop. We
  resolved every issue we hit (better-sqlite3 native build, shared/dist build
  ordering, port 6379 conflict, the bad_public_key from a PEM missing
  BEGIN/END markers due to chat-app mangling, a token missing its signature
  segment, and a stale api Docker image not picking up new env). All
  documented in the "Known gotchas" section above.
- **Local demo via cloudflared was just exercised end-to-end** — the user
  spun up the casino stack on `localhost:8080`, tunneled it, then rebuilt
  the api against the live VPS license server using a fresh "Demo" customer
  token. License verify, suspend, resume all confirmed working over the
  public internet on a 30 s heartbeat. Tunnel and containers stopped after.

### Persistent state to know about

- **`docker-compose.license-test.yml`** has been rewritten to point at the
  VPS (`https://144-91-84-61.nip.io`) and uses `LICENSE_PUBLIC_KEY_PATH`
  mounted from `./.license-keys/public.pem` — the robust approach. Old
  `host.docker.internal` form is gone.
- **`.license-keys/public.pem`** holds the vendor's public key on the user's
  Mac, fetched fresh from `https://144-91-84-61.nip.io/public-key`.
  Gitignored.
- **api Docker image was rebuilt** with the verify.ts that supports
  `LICENSE_PUBLIC_KEY_PATH` + CRLF/quote stripping. The next `docker compose
  build` will keep this; an older image floating around would not.
- **"Demo" customer** exists on the VPS at `cus_553d9d0f1ffc313a`. Its 30-day
  license token is in `/tmp/lic.env` on the user's Mac (won't survive a reboot;
  re-issue from the admin UI if needed).
- **Phase 1 + all polish is shipped.** 11 unit tests + 78 e2e tests green
  across Chromium + WebKit at last full run.

### Resuming work — likely next steps

Pick whichever the user signals. Don't assume.

- **First release setup (one-time).**
  1. Rename `AzhdanYulmi/hzaconnect-install` → `hzaconnect` on GitHub. It's
     already public.
  2. From this folder: `git init -b main && git remote add origin
     git@github.com:AzhdanYulmi/hzaconnect.git && git add . && git commit -m
     "Initial commit" && git push -u origin main`.
  3. After CI / repo settles, tag: `git tag v0.1.0 && git push origin v0.1.0`.
     Triggers `.github/workflows/release.yml`.
  4. After the workflow finishes, flip the two GHCR packages
     (`hzaconnect-api`, `hzaconnect-edge`) to **Public** via
     github.com/users/AzhdanYulmi/packages — otherwise customer `docker pull`
     will require auth.
- **Run the easy-deploy installer end-to-end** on a fresh VPS (or Vagrant box)
  to validate the full flow against the live license server. Doctor should
  finish all green.
- **Buy a real domain** to replace `144-91-84-61.nip.io`. Cloudflare-registered,
  point an A record (DNS-only/grey-cloud) at the Contabo IP, change
  `LICENSE_DOMAIN` in `deploy/.env.license`, restart Caddy. ~10 min.
- **Build the SSO upgrade endpoint** — `POST /api/widget/session/upgrade`,
  JWKS verification, widget-side `identify(token)` flow. Schema is already
  there (`session_identifiers.source = 'sso'`).
- **Mobile-friendly widget pass** — the panel needs to go full-screen below
  480 px viewport. Partially in place but untested. Add a Playwright
  responsive test.
- **Outbound webhooks** for casino CRM integration (chat.opened,
  chat.resolved, etc.).
- **Add Firefox to the Playwright matrix** — currently only Chromium + WebKit.
- **Harden licensing in production** — bake the public key into the api
  source code (or read from a Docker secret) instead of env var, so a casino
  can't easily bypass by setting `LICENSE_ENFORCEMENT=disabled`. This was
  flagged in `docs/licensing.md` as a Phase 2 follow-up.

---

## Source of truth

When in doubt, the canonical sources are:

1. **The code** — types in `packages/shared/src/events.ts` and
   `apps/api/src/db/schema.ts` define every wire/data contract.
2. **The README** — high-level deploy walkthrough for casinos.
3. **`docs/licensing.md`** — vendor's runbook for licensing operations.
4. **This file** — context primer, updated after each major milestone.

If you change something significant, update this file. It exists to make
the *next* session productive.
