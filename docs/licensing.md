# Licensing

This document is for **you, the vendor** — it explains how to run the license server, issue licenses, hand them to casinos, and remotely disable a deployment when a customer doesn't pay.

## Architecture, in one paragraph

Every casino's API is gated by an Ed25519-signed license token plus a periodic heartbeat to a license server you operate. At startup the API verifies the signature on the token (offline, no network needed). It then phones home every 30 minutes; if your license server marks the customer as suspended, the API blocks every business route within one heartbeat cycle. The casino's agents can still read past transcripts, but the widget stops working and new conversations can't be created. There is no other way to bypass the kill switch except editing source code and recompiling.

## What runs where

| Component | Where it runs | Owner |
|---|---|---|
| `apps/license-server` | A small VPS / Cloudflare Worker / your laptop | **you** |
| `apps/api` (the casino's chat API) | Casino's infra | the casino |
| `apps/dashboard` (the chat dashboard) | Casino's infra | the casino |
| `apps/widget` (player widget) | Casino's website | the casino |

You only host the license server. Everything else is on the casino's side, exactly as before.

## One-time setup (your side)

### 1. Generate a real keypair

The repo ships a *test* keypair under `packages/license/test-keys/` so dev/CI works. Production needs your own:

```bash
pnpm --filter @hzaconnect/license-server keys:generate
# → writes apps/license-server/keys/{public.pem,private.pem}
```

Keep `private.pem` on the license server only. Off your laptop. Off any shared volume. Out of git.

### 2. Run the license server

```bash
cp apps/license-server/.env.example apps/license-server/.env
# edit:
#   ADMIN_USERNAME=you
#   ADMIN_PASSWORD=<long random string>
#   LICENSE_PRIVATE_KEY_PATH=/etc/hzaconnect/private.pem
#   LICENSE_PUBLIC_KEY_PATH=/etc/hzaconnect/public.pem
#   COOKIE_SECRET=<long random string>
pnpm --filter @hzaconnect/license-server build
pnpm --filter @hzaconnect/license-server start
```

It listens on port 4400 by default. Put nginx in front for TLS. Hosting cost: $5/month VPS handles thousands of customers because traffic is one POST per customer per 30 minutes.

The admin UI is at `https://licenses.your-domain.example/admin` behind HTTP basic auth.

## Onboarding a new casino

### Step 1 — issue a license (admin UI)

1. Log in to your license server's `/admin`
2. **Customer name**: "Acme Casino"
3. **Contact email**: optional but useful when you need to chase payment
4. **Initial license duration**: 30 days (or whatever billing cycle you've agreed)
5. Click **Create + issue license**

The next page shows the signed token in a `<pre>` block. **Copy it now** — for security it's not retrievable later (you'd just issue a new one if you forget).

### Step 1 — issue a license (CLI alternative)

```bash
pnpm --filter @hzaconnect/license-server issue issue \
  --name "Acme Casino" \
  --email "ops@acme.example" \
  --days 30
# Token printed to stdout
```

### Step 2 — give the casino three things

Send the casino's IT team:

1. **The license token** (the long base64-ish string)
2. **Your public key** (`apps/license-server/keys/public.pem` content, or `https://licenses.your-domain.example/public-key`)
3. **Your license server URL** (e.g. `https://licenses.your-domain.example`)

They paste these into their `.env`:

```bash
LICENSE_ENFORCEMENT=enabled
LICENSE_TOKEN=eyJjdXN0b21lci…
LICENSE_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----
MCowBQ…
-----END PUBLIC KEY-----"
LICENSE_SERVER_URL=https://licenses.your-domain.example
```

Restart the API container. It logs `license verified` with the customer name and starts heartbeating.

## Enforcement actions you can take

### Suspend (instant kill switch)

1. Log in to `/admin`
2. Find the customer
3. Click **suspend**

Within one heartbeat cycle (≤30 min by default) the casino's API enters suspended mode:
- All business REST endpoints return `503` with `{"error": "service_suspended", "message": "Service suspended."}`
- WebSocket connections refuse the handshake with reason `service_suspended`
- The dashboard shows a red banner "Service suspended."
- Past transcripts remain readable to agents (we don't take down auth/me/refresh)

### Resume

Click **resume** on the customer page. Within one heartbeat cycle, the API is back to normal.

### Issue a renewal

Customer paid for another 30 days? Go to their customer page → **Issue new license** → copy the new token → send it. They update `LICENSE_TOKEN` in `.env` and restart the API.

The old license is automatically expired by its own `expires_at` even if you don't revoke it.

### Revoke a specific license token

If a token leaked or was issued by mistake, click **revoke** on that license row. The next heartbeat from anyone presenting that exact token is rejected with `revoked`. The customer is fine; that one token is dead.

### Permanently disable a customer

Suspend them, then leave them suspended. Their license expires after `expires_at` regardless. Don't issue renewals.

## How the casino can NOT bypass this

- **Edit the public key**: They'd need to recompile the API binary (we ship pre-built Docker images). Even then, they need a different license token signed by *some* private key — they don't have yours.
- **Block your license server's domain**: Heartbeats fail. The grace window (`LICENSE_HEARTBEAT_GRACE_SECONDS`, default 24 h) keeps things working through brief outages. After that, the API enters suspended mode anyway.
- **Set their clock back**: The signed `expires_at` is a Unix timestamp; we compare to `Date.now()`. If they actively tamper with NTP, they buy time but their messages will arrive with wrong timestamps which their players will notice.
- **Delete `LICENSE_ENFORCEMENT=enabled`**: The default is `enabled`, so they'd need to actively set `disabled`. If you ship pre-built images with the master switch hardcoded, this attack vector goes away too. Today the master switch is the env var — that's a known soft spot for ironclad protection but matches what was requested.

For an ironclad future variant: bake `LICENSE_ENFORCEMENT="enabled"` as a constant in source rather than reading it from env. Or bake the public key in source (`packages/license-public/index.ts` exporting the literal PEM string). Both move the bypass cost from "edit one env var" to "fork and rebuild," which is a deliberate IP theft event your contract should make actionable.

## Test workflow

`apps/e2e/tests/12-licensing.spec.ts` covers:
- Heartbeat for unknown license returns `suspended`
- Issue → heartbeat ok → suspend → heartbeat suspended → resume → heartbeat ok
- Admin endpoints reject unauthenticated requests
- Dashboard renders the suspended banner when `/api/license/status` returns `ok:false`
- Dashboard does not render the banner when status is ok

Spin up the license server in dev:

```bash
pnpm --filter @hzaconnect/license-server dev
# Open http://localhost:4400/admin, log in admin / change-me-in-production
```

To run the casino API in license-enforced mode against your local license server:

```bash
# 1. Issue a dev license
pnpm --filter @hzaconnect/license-server issue issue --name "Local Dev" --days 365
# Copy the token.

# 2. In .env:
LICENSE_ENFORCEMENT=enabled
LICENSE_TOKEN=<paste>
LICENSE_SERVER_URL=http://localhost:4400
# (LICENSE_PUBLIC_KEY_PEM is auto-loaded from the test-keys in non-production)

# 3. Restart API
```

Suspend yourself in the admin UI to see the banner appear within `LICENSE_HEARTBEAT_SECONDS` (default 30 min in prod, 30 sec in the dev `.env`).

## Operational checklist before going live

- [ ] Generated production keypair, private key permissioned 0600, off all backups except encrypted offsite
- [ ] License server reachable over HTTPS with a valid cert
- [ ] Admin password is not the default
- [ ] Database backed up nightly (`apps/license-server/data/license-server.db`)
- [ ] You have a runbook for "customer hasn't paid, suspend them" — currently 5 clicks
- [ ] The casino's `.env` does NOT have `LICENSE_ENFORCEMENT=disabled` (your sales/ops checklist verifies this on handoff)
