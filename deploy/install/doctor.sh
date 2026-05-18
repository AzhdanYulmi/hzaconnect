#!/usr/bin/env bash
# Diagnostic for an hzaconnect install. Read-only — never modifies state.
# Exit code 0 if all green, 1 if any failure.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'
  c_blu=$'\033[34m'; c_bold=$'\033[1m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
else
  c_red=""; c_grn=""; c_yel=""; c_blu=""; c_bold=""; c_dim=""; c_off=""
fi

FAILED=0
WARNED=0

section() { printf "\n%s%s── %s ──%s\n" "$c_bold" "$c_blu" "$1" "$c_off"; }
pass()    { printf "  %s✓%s %s\n" "$c_grn" "$c_off" "$1"; }
fail()    { printf "  %s✗%s %s\n" "$c_red" "$c_off" "$1"; [ -n "${2:-}" ] && printf "    %shint:%s %s\n" "$c_dim" "$c_off" "$2"; FAILED=$((FAILED+1)); }
warn()    { printf "  %s!%s %s\n" "$c_yel" "$c_off" "$1"; [ -n "${2:-}" ] && printf "    %shint:%s %s\n" "$c_dim" "$c_off" "$2"; WARNED=$((WARNED+1)); }

# Need .env loaded for most checks
if [ ! -f .env ]; then
  fail ".env not found in $SCRIPT_DIR" "run install.sh first"
  exit 1
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

COMPOSE="docker compose --env-file ./.env -f ./docker-compose.deploy.yml"

# ===========================================================================
section "Environment"
# ===========================================================================

required_vars=(DOMAIN PUBLIC_ORIGIN LICENSE_TOKEN LICENSE_SERVER_URL \
  BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD \
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD \
  S3_ACCESS_KEY S3_SECRET_KEY AUTH_JWT_SECRET WIDGET_JWT_SECRET \
  HZA_REGISTRY HZA_VERSION)

# Detect HTTP vs HTTPS mode from PUBLIC_ORIGIN
case "${PUBLIC_ORIGIN:-}" in
  http://*)  TLS_MODE=off ;;
  https://*) TLS_MODE=on  ;;
  *)         TLS_MODE=on  ;;
esac

missing=()
for v in "${required_vars[@]}"; do
  if [ -z "${!v:-}" ]; then missing+=("$v"); fi
done
if [ ${#missing[@]} -gt 0 ]; then
  fail "missing required vars: ${missing[*]}" "re-run install.sh"
else
  pass "all required vars set"
fi

# DOMAIN format
case "$DOMAIN" in
  http://*|https://*|*/*) fail "DOMAIN should be a bare hostname (no scheme/path): $DOMAIN" ;;
  localhost|127.0.0.1)
    if [ "$TLS_MODE" = "off" ]; then
      pass "DOMAIN is localhost (HTTP mode)"
    else
      warn "DOMAIN is localhost but TLS_MODE=on — Caddy can't acquire a public cert for localhost"
    fi ;;
  *.*) pass "DOMAIN is a fqdn-shaped string: $DOMAIN" ;;
  *)   warn "DOMAIN '$DOMAIN' is not a fully-qualified hostname" ;;
esac

# Mode banner
if [ "$TLS_MODE" = "off" ]; then
  pass "TLS mode: OFF (HTTP only, --no-tls install)"
fi

# PUBLIC_ORIGIN scheme matches mode
expected_origin="${TLS_MODE:+https}://$DOMAIN"
[ "$TLS_MODE" = "off" ] && expected_origin="http://$DOMAIN"
[ "$PUBLIC_ORIGIN" = "$expected_origin" ] && pass "PUBLIC_ORIGIN matches DOMAIN ($PUBLIC_ORIGIN)" \
  || warn "PUBLIC_ORIGIN ($PUBLIC_ORIGIN) does not match expected $expected_origin"

# License token shape (hzaconnect uses payload.signature — 2 segments)
seg_count=$(printf '%s' "$LICENSE_TOKEN" | awk -F. '{print NF}')
[ "$seg_count" = "2" ] && pass "license token has 2 segments" \
  || fail "license token has $seg_count segments, expected 2" "did chat strip part of the token?"

# CRLF / quote contamination
case "$LICENSE_TOKEN" in
  *$'\r'*) fail "LICENSE_TOKEN contains CR (carriage return)" "rewrite the line with: dos2unix .env" ;;
  \"*\"|\'*\') fail "LICENSE_TOKEN is wrapped in quotes — they will be sent literally" "remove the surrounding quotes" ;;
  *) pass "license token has no CRLF / quote contamination" ;;
esac

# Public key
PK="./license-keys/public.pem"
if [ ! -f "$PK" ]; then
  fail "license public key missing: $PK" "re-fetch with: curl -o $PK ${LICENSE_SERVER_URL%/}/public-key"
else
  if grep -q "BEGIN PUBLIC KEY" "$PK" && grep -q "END PUBLIC KEY" "$PK"; then
    pass "license public key has BEGIN/END markers"
  else
    fail "license public key missing BEGIN/END markers" "chat-app probably mangled it; re-fetch from license server"
  fi
  if grep -q $'\r' "$PK"; then
    fail "license public key has CRLF line endings" "fix: sed -i 's/\\r\$//' $PK"
  else
    pass "license public key has clean line endings"
  fi
fi

# Port conflicts (best-effort)
for p in 80 443; do
  if ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E ":$p\$" >/dev/null; then
    # Allow Caddy itself to be listening
    holder=$(ss -tlnpH 2>/dev/null | awk -v port=":$p" '$4 ~ port { for (i=1;i<=NF;i++) if ($i ~ /users:/) print $i }')
    case "$holder" in
      *caddy*|*docker*) pass "port $p is bound by docker/caddy (expected)" ;;
      "") warn "port $p is in use (couldn't identify holder)" ;;
      *) fail "port $p is in use by something other than caddy: $holder" "stop the conflicting service before starting edge" ;;
    esac
  else
    pass "port $p is free or held by docker"
  fi
done

# ===========================================================================
section "License server"
# ===========================================================================

LS_URL="${LICENSE_SERVER_URL%/}"

if curl -fsS --max-time 10 "$LS_URL/public-key" -o /tmp/hza-doctor-pk 2>/dev/null; then
  pass "license server reachable: $LS_URL"
  if [ -f "$PK" ] && diff -q <(tr -d '\r' < "$PK") <(tr -d '\r' < /tmp/hza-doctor-pk) >/dev/null 2>&1; then
    pass "local public key matches license server"
  else
    fail "local public key DIFFERS from license server" "vendor may have rotated keys — fetch new: curl -o $PK $LS_URL/public-key"
  fi
  rm -f /tmp/hza-doctor-pk
else
  fail "license server NOT reachable at $LS_URL" "DNS / firewall / wrong URL. Without it, suspended state cannot lift."
fi

# Heartbeat status from api container (if up)
if $COMPOSE ps api 2>/dev/null | grep -q "Up"; then
  status_json=$($COMPOSE exec -T api node -e "fetch('http://localhost:3000/internal/license-status').then(r=>r.text()).then(t=>console.log(t)).catch(e=>{console.error(e.message);process.exit(1)})" 2>/dev/null || true)
  if [ -n "$status_json" ]; then
    case "$status_json" in
      *'"state":"active"'*)    pass "api reports license state: active" ;;
      *'"state":"suspended"'*) fail "api reports license state: SUSPENDED" "contact your vendor" ;;
      *'"state":"expired"'*)   fail "api reports license state: EXPIRED" "request a renewal token" ;;
      *) warn "api license-status returned unexpected payload: $status_json" ;;
    esac
  else
    warn "could not query api /internal/license-status (endpoint may not exist in this image)"
  fi
fi

# ===========================================================================
section "Containers"
# ===========================================================================

services=(postgres redis minio api edge)
for svc in "${services[@]}"; do
  state=$($COMPOSE ps --format '{{.State}}' "$svc" 2>/dev/null | head -n1)
  if [ -z "$state" ]; then
    fail "$svc is not running" "start with: hzaconnect restart $svc"
  elif [ "$state" = "running" ]; then
    health=$($COMPOSE ps --format '{{.Health}}' "$svc" 2>/dev/null | head -n1)
    case "$health" in
      ""|"unknown")     pass "$svc running (no healthcheck)" ;;
      "healthy")        pass "$svc healthy" ;;
      "starting")       warn "$svc still starting" ;;
      "unhealthy")      fail "$svc unhealthy" "tail logs: hzaconnect logs $svc" ;;
      *)                warn "$svc state=$state health=$health" ;;
    esac
  else
    fail "$svc state=$state" "tail logs: hzaconnect logs $svc"
  fi
done

# Migrations applied?
if $COMPOSE ps postgres 2>/dev/null | grep -q "running"; then
  table_count=$($COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo "0")
  if [ "$table_count" -gt 5 ]; then
    pass "postgres has $table_count tables (migrations applied)"
  else
    fail "postgres has only $table_count tables" "run: $COMPOSE run --rm api node apps/api/dist/db/migrate.js"
  fi
fi

# Caddy cert acquired? (only in TLS mode)
if [ "$TLS_MODE" = "on" ] && $COMPOSE ps edge 2>/dev/null | grep -q "running"; then
  if $COMPOSE exec -T edge sh -c "ls /data/caddy/certificates/*/$DOMAIN/$DOMAIN.crt" >/dev/null 2>&1; then
    pass "TLS certificate present for $DOMAIN"
  else
    warn "no TLS certificate on disk for $DOMAIN yet" "Caddy acquires the cert on first HTTPS request — check DNS + ports"
  fi
fi

# ===========================================================================
section "External"
# ===========================================================================

# DNS (skip for localhost / HTTP mode — won't resolve usefully)
case "$DOMAIN" in
  localhost|127.0.0.1)
    pass "DNS: $DOMAIN (no resolution needed for HTTP mode)" ;;
  *)
    resolved=$(getent ahosts "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
    if [ -n "$resolved" ]; then
      pass "DNS: $DOMAIN → $resolved"
    elif [ "$TLS_MODE" = "off" ]; then
      warn "DNS: $DOMAIN does not resolve (OK if you access only via tunnel)"
    else
      fail "DNS: $DOMAIN does not resolve" "add an A record pointing at this server's public IP"
    fi ;;
esac

# API reachable via configured PUBLIC_ORIGIN
if curl -fsS --max-time 10 "$PUBLIC_ORIGIN/api/health" >/dev/null 2>&1; then
  pass "API reachable: $PUBLIC_ORIGIN/api/health"
else
  if [ "$TLS_MODE" = "off" ]; then
    fail "$PUBLIC_ORIGIN/api/health did not respond" "check: edge container, port 80"
  else
    fail "$PUBLIC_ORIGIN/api/health did not respond" "check: TLS cert, edge container, firewall on 443"
  fi
fi

# Dashboard reachable
if curl -fsS --max-time 10 -o /dev/null "$PUBLIC_ORIGIN/dashboard/"; then
  pass "dashboard reachable: $PUBLIC_ORIGIN/dashboard/"
else
  fail "dashboard not reachable" "edge may be misrouting — see: hzaconnect logs edge"
fi

# widget.js reachable + CORS
cors=$(curl -fsS --max-time 10 -I "$PUBLIC_ORIGIN/widget.js" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')
if [ -n "$cors" ]; then
  pass "widget.js served with CORS: Access-Control-Allow-Origin: $cors"
else
  fail "widget.js missing Access-Control-Allow-Origin header" "casino sites embedding this widget will be blocked by browsers"
fi

# TLS cert expiry (only in TLS mode)
if [ "$TLS_MODE" = "on" ]; then
  if expiry=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN":443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2); then
    if [ -n "$expiry" ]; then
      expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null || date -j -f "%b %e %T %Y %Z" "$expiry" +%s 2>/dev/null || echo 0)
      now_epoch=$(date +%s)
      days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
      if [ "$days_left" -gt 14 ]; then
        pass "TLS cert valid for $days_left more days"
      elif [ "$days_left" -gt 0 ]; then
        warn "TLS cert expires in $days_left days" "Caddy should auto-renew 30 days out — check edge logs"
      else
        fail "TLS cert has expired or invalid" "Caddy renewal is broken — see: hzaconnect logs edge"
      fi
    fi
  fi
fi

# ===========================================================================
printf "\n"
if [ "$FAILED" -gt 0 ]; then
  printf "%s%s%d check(s) failed%s, %d warning(s)\n" "$c_bold" "$c_red" "$FAILED" "$c_off" "$WARNED"
  exit 1
elif [ "$WARNED" -gt 0 ]; then
  printf "%s%sAll checks passed%s with %d warning(s)\n" "$c_bold" "$c_yel" "$c_off" "$WARNED"
  exit 0
else
  printf "%s%sAll checks passed%s\n" "$c_bold" "$c_grn" "$c_off"
  exit 0
fi
