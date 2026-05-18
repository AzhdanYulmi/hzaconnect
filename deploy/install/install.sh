#!/usr/bin/env bash
# hzaconnect installer. Interactive by default; fully flag-driven for unattended use.
#
#   ./install.sh --domain chat.acme.com --token <LICENSE> --admin-email me@acme.com
#
# Re-running on an existing install is safe: secrets are preserved.
# Use --force to regenerate the entire .env (DESTRUCTIVE — wipes credentials).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---- defaults ----
DOMAIN=""
LICENSE_TOKEN=""
LICENSE_SERVER_URL="https://144-91-84-61.nip.io"
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
ACME_EMAIL=""
GHCR_TOKEN=""
GHCR_USER=""
HZA_REGISTRY=""
HZA_VERSION="latest"
NON_INTERACTIVE=0
FORCE=0

# ---- styling ----
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'
  c_blu=$'\033[34m'; c_bold=$'\033[1m'; c_off=$'\033[0m'
else
  c_red=""; c_grn=""; c_yel=""; c_blu=""; c_bold=""; c_off=""
fi
say()   { printf "%s==>%s %s\n" "$c_blu" "$c_off" "$*"; }
ok()    { printf "%s ✓ %s%s\n" "$c_grn" "$*" "$c_off"; }
warn()  { printf "%s ! %s%s\n" "$c_yel" "$*" "$c_off"; }
die()   { printf "%s ✗ %s%s\n" "$c_red" "$*" "$c_off" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $0 [options]

Required:
  --domain DOMAIN              Public hostname (e.g. chat.acme.com)
  --token TOKEN                License token issued by your vendor
  --admin-email EMAIL          Bootstrap admin email

Optional:
  --admin-password PW          Admin password (default: auto-generate + print)
  --acme-email EMAIL           Let's Encrypt contact (default: admin email)
  --license-server URL         Vendor license server (default: $LICENSE_SERVER_URL)
  --registry REGISTRY          Image registry (default: ghcr.io/AzhdanYulmi)
  --version TAG                Image tag to pull (default: latest)
  --ghcr-user USER             GHCR username for docker login (if registry is private)
  --ghcr-token TOKEN           GHCR PAT (read:packages) for docker login
  --non-interactive            Fail on missing required values instead of prompting
  --force                      Overwrite existing .env (destructive)
  -h, --help                   Show this message
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)          DOMAIN="$2"; shift 2 ;;
    --token)           LICENSE_TOKEN="$2"; shift 2 ;;
    --license-server)  LICENSE_SERVER_URL="$2"; shift 2 ;;
    --admin-email)     ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-password)  ADMIN_PASSWORD="$2"; shift 2 ;;
    --acme-email)      ACME_EMAIL="$2"; shift 2 ;;
    --registry)        HZA_REGISTRY="$2"; shift 2 ;;
    --version)         HZA_VERSION="$2"; shift 2 ;;
    --ghcr-user)       GHCR_USER="$2"; shift 2 ;;
    --ghcr-token)      GHCR_TOKEN="$2"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --force)           FORCE=1; shift ;;
    -h|--help)         usage; exit 0 ;;
    *) die "unknown flag: $1 (try --help)" ;;
  esac
done

# ---- prerequisites ----
say "Checking prerequisites"
command -v docker >/dev/null 2>&1 || die "docker not found. Install: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "docker compose plugin not found. Install: https://docs.docker.com/compose/install/"
command -v openssl >/dev/null 2>&1 || die "openssl required (for secret generation)"
command -v curl    >/dev/null 2>&1 || die "curl required (for license-server fetch)"
ok "docker, compose, openssl, curl present"

# ---- prompts for missing values ----
prompt() {
  local var="$1" label="$2" default="${3:-}" silent="${4:-0}"
  [ "$NON_INTERACTIVE" = "1" ] && die "missing $label (run interactively or pass the flag)"
  local val=""
  if [ "$silent" = "1" ]; then
    read -rs -p "$label${default:+ [$default]}: " val
    echo
  else
    read -r  -p "$label${default:+ [$default]}: " val
  fi
  printf -v "$var" '%s' "${val:-$default}"
}

[ -z "$DOMAIN" ]        && prompt DOMAIN "Public domain (e.g. chat.acme.com)"
[ -z "$LICENSE_TOKEN" ] && prompt LICENSE_TOKEN "License token from your vendor"
[ -z "$ADMIN_EMAIL" ]   && prompt ADMIN_EMAIL "Admin email"
[ -z "$ACME_EMAIL" ]    && ACME_EMAIL="$ADMIN_EMAIL"

# ---- clean and validate token ----
# Defuse the most common transmission hazards: CRLF from Windows .env, stray
# whitespace, and chat-app-added surrounding quotes.
LICENSE_TOKEN="$(printf '%s' "$LICENSE_TOKEN" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
seg_count=$(printf '%s' "$LICENSE_TOKEN" | awk -F. '{print NF}')
[ "$seg_count" = "3" ] || die "license token must have 3 segments (header.payload.signature), got $seg_count. Did chat strip part of it?"
ok "License token shape valid"

# ---- domain sanity ----
case "$DOMAIN" in
  http://*|https://*) die "DOMAIN should be a bare hostname (no scheme): $DOMAIN" ;;
  */*) die "DOMAIN should be a bare hostname (no path): $DOMAIN" ;;
esac
ok "Domain: $DOMAIN"

# ---- fetch vendor public key ----
say "Fetching public key from $LICENSE_SERVER_URL"
mkdir -p ./license-keys
if ! curl -fsS --max-time 15 "${LICENSE_SERVER_URL%/}/public-key" -o ./license-keys/public.pem; then
  die "could not fetch ${LICENSE_SERVER_URL%/}/public-key — network down, or vendor URL is wrong"
fi
# Strip CRLF if the server (or a proxy) returned them
sed -i.bak 's/\r$//' ./license-keys/public.pem 2>/dev/null || true
rm -f ./license-keys/public.pem.bak
grep -q "BEGIN PUBLIC KEY" ./license-keys/public.pem || die "fetched file is not a PEM public key — check $LICENSE_SERVER_URL"
grep -q "END PUBLIC KEY"   ./license-keys/public.pem || die "fetched PEM is missing END marker — partial download?"
chmod 644 ./license-keys/public.pem
ok "Public key cached at ./license-keys/public.pem"

# ---- secret generation ----
gen_pw()  { openssl rand -base64 32 | tr -d '/+=\n' | cut -c1-32; }
gen_key() { openssl rand -base64 48 | tr -d '\n'; }

# ---- .env handling ----
if [ -f .env ] && [ "$FORCE" != "1" ]; then
  say "Existing .env detected — preserving generated secrets, refreshing customer-facing values"
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(gen_pw)}"
  S3_ACCESS_KEY="${S3_ACCESS_KEY:-$(gen_pw)}"
  S3_SECRET_KEY="${S3_SECRET_KEY:-$(gen_key)}"
  AUTH_JWT_SECRET="${AUTH_JWT_SECRET:-$(gen_key)}"
  WIDGET_JWT_SECRET="${WIDGET_JWT_SECRET:-$(gen_key)}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-${BOOTSTRAP_ADMIN_PASSWORD:-$(gen_pw)}}"
else
  [ -f .env ] && warn "Overwriting .env (--force)"
  POSTGRES_PASSWORD=$(gen_pw)
  S3_ACCESS_KEY=$(gen_pw)
  S3_SECRET_KEY=$(gen_key)
  AUTH_JWT_SECRET=$(gen_key)
  WIDGET_JWT_SECRET=$(gen_key)
  [ -z "$ADMIN_PASSWORD" ] && ADMIN_PASSWORD=$(gen_pw)
fi

[ -z "$HZA_REGISTRY" ] && HZA_REGISTRY="ghcr.io/AzhdanYulmi"

PUBLIC_ORIGIN="https://${DOMAIN}"

say "Writing .env"
umask 077
cat > .env <<EOF
# Generated by install.sh on $(date -u +%FT%TZ)
DOMAIN=${DOMAIN}
PUBLIC_ORIGIN=${PUBLIC_ORIGIN}
ACME_EMAIL=${ACME_EMAIL}

LICENSE_TOKEN=${LICENSE_TOKEN}
LICENSE_SERVER_URL=${LICENSE_SERVER_URL%/}
LICENSE_HEARTBEAT_SECONDS=1800
LICENSE_HEARTBEAT_GRACE_SECONDS=86400

BOOTSTRAP_ADMIN_EMAIL=${ADMIN_EMAIL}
BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PASSWORD}
BOOTSTRAP_ADMIN_DISPLAY_NAME=Admin

POSTGRES_DB=hzaconnect
POSTGRES_USER=hzaconnect
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
S3_REGION=us-east-1
S3_BUCKET=hzaconnect-attachments
S3_ACCESS_KEY=${S3_ACCESS_KEY}
S3_SECRET_KEY=${S3_SECRET_KEY}
AUTH_JWT_SECRET=${AUTH_JWT_SECRET}
WIDGET_JWT_SECRET=${WIDGET_JWT_SECRET}

API_LOG_LEVEL=info
WIDGET_ALLOWED_ORIGINS=*
COOKIE_DOMAIN=

HZA_REGISTRY=${HZA_REGISTRY}
HZA_VERSION=${HZA_VERSION}
EOF
umask 022
chmod 600 .env
ok ".env written (mode 600)"

# ---- GHCR login if creds provided ----
if [ -n "$GHCR_TOKEN" ]; then
  GHCR_USER="${GHCR_USER:-hzaconnect-deploy}"
  say "Logging in to ghcr.io as $GHCR_USER"
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null \
    || die "ghcr.io login failed — verify the PAT has read:packages scope"
  ok "Authenticated to ghcr.io"
fi

# ---- compose helpers ----
COMPOSE="docker compose --env-file ./.env -f ./docker-compose.deploy.yml"

say "Pulling images ($HZA_REGISTRY @ $HZA_VERSION)"
$COMPOSE pull
ok "Images present"

say "Starting infrastructure (postgres, redis, minio)"
$COMPOSE up -d postgres redis minio
for i in $(seq 1 30); do
  if $COMPOSE ps postgres | grep -q "healthy"; then ok "Postgres healthy"; break; fi
  [ "$i" = "30" ] && die "Postgres did not become healthy in 60s — see: $COMPOSE logs postgres"
  sleep 2
done

say "Running database migrations"
$COMPOSE run --rm api node apps/api/dist/db/migrate.js
ok "Migrations applied"

say "Seeding bootstrap admin"
$COMPOSE run --rm api node apps/api/dist/db/seed.js
ok "Bootstrap admin seeded"

say "Starting api"
$COMPOSE up -d api
for i in $(seq 1 30); do
  if $COMPOSE exec -T api node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok "API healthy"; break
  fi
  [ "$i" = "30" ] && die "API did not respond in 60s — see: $COMPOSE logs api"
  sleep 2
done

say "Starting edge (Caddy) — acquiring TLS cert for $DOMAIN"
$COMPOSE up -d edge

# Wait for cert acquisition: Caddy obtains its cert on first request matching
# the HTTPS host. We poll the public domain over HTTPS up to 90s.
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
    ok "TLS live on https://${DOMAIN}"; break
  fi
  [ "$i" = "30" ] && warn "TLS not yet live on https://${DOMAIN}. Check DNS + ports 80/443. Run \`hzaconnect doctor\`."
  sleep 3
done

# ---- summary ----
cat <<EOF

${c_bold}${c_grn}=== Install complete ===${c_off}

  Dashboard:       https://${DOMAIN}/dashboard/
  Admin email:     ${ADMIN_EMAIL}
  Admin password:  ${ADMIN_PASSWORD}

  Embed snippet for your casino site:

    <script src="https://${DOMAIN}/widget.js" async></script>

  Next steps:
    hzaconnect doctor   — verify everything is healthy
    hzaconnect status   — show service + license status
    hzaconnect logs api — tail API logs
    hzaconnect update   — pull a new release

EOF
