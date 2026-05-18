#!/usr/bin/env bash
# One-shot deploy of the vendor-side license server on a fresh Ubuntu/Debian VPS.
#
# Run on the VPS, in the cloned repo:
#   bash scripts/deploy-license-server.sh licenses.yourbrand.com you@yourbrand.com
#
# What it does:
#   1. Installs Docker + compose plugin if missing
#   2. Generates a fresh Ed25519 keypair (only the first run)
#   3. Generates a strong ADMIN_PASSWORD and COOKIE_SECRET
#   4. Writes apps/license-server/.env and deploy/.env.license
#   5. Brings up `docker compose -f docker-compose.license.yml`
#   6. Prints the admin URL, credentials, and public key — save these.
#
# Idempotent: re-running won't regenerate keys or overwrite the password.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  cat <<EOF >&2
Usage: $0 <domain> <acme-email>
  domain      e.g. licenses.yourbrand.com (must already point at this VPS)
  acme-email  used by Let's Encrypt for renewal notices

Example:
  bash scripts/deploy-license-server.sh licenses.yourbrand.com ops@yourbrand.com
EOF
  exit 2
fi

# Run from the repo root regardless of where the user invoked it.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---- 1. Docker ----
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sh
  # Allow the current (non-root) user to run docker without sudo on next login.
  if [ -n "${SUDO_USER:-}" ]; then
    usermod -aG docker "$SUDO_USER" || true
  elif [ "$(id -u)" != "0" ]; then
    sudo usermod -aG docker "$USER" || true
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin is missing. Reinstall Docker via get.docker.com." >&2
  exit 1
fi

# ---- 2. Keypair ----
KEY_DIR="$REPO_ROOT/apps/license-server/keys"
mkdir -p "$KEY_DIR"
if [ ! -f "$KEY_DIR/private.pem" ] || [ ! -f "$KEY_DIR/public.pem" ]; then
  echo "==> Generating Ed25519 keypair"
  # Use OpenSSL directly — no pnpm install needed for first boot.
  openssl genpkey -algorithm Ed25519 -out "$KEY_DIR/private.pem"
  openssl pkey -in "$KEY_DIR/private.pem" -pubout -out "$KEY_DIR/public.pem"
  chmod 600 "$KEY_DIR/private.pem"
  chmod 644 "$KEY_DIR/public.pem"
else
  echo "==> Reusing existing keypair at $KEY_DIR"
fi

# ---- 3. Secrets + .env files ----
ENV_FILE="$REPO_ROOT/apps/license-server/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "==> Generating apps/license-server/.env with fresh secrets"
  ADMIN_PW="$(openssl rand -base64 32 | tr -d '/=+\n')"
  COOKIE_SECRET="$(openssl rand -base64 32 | tr -d '/=+\n')"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=4400
HOST=0.0.0.0
DB_PATH=/app/apps/license-server/data/license-server.db
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PW
COOKIE_SECRET=$COOKIE_SECRET
LICENSE_PRIVATE_KEY_PATH=/app/apps/license-server/keys/private.pem
LICENSE_PUBLIC_KEY_PATH=/app/apps/license-server/keys/public.pem
DEFAULT_LICENSE_DAYS=30
EOF
  chmod 600 "$ENV_FILE"
else
  echo "==> Reusing existing $ENV_FILE"
fi

LICENSE_ENV="$REPO_ROOT/deploy/.env.license"
if [ ! -f "$LICENSE_ENV" ] || ! grep -q "^LICENSE_DOMAIN=$DOMAIN$" "$LICENSE_ENV" 2>/dev/null; then
  cat > "$LICENSE_ENV" <<EOF
LICENSE_DOMAIN=$DOMAIN
ACME_EMAIL=$EMAIL
EOF
fi

# ---- 4. Bring up the stack ----
echo "==> Building images"
docker compose -f docker-compose.license.yml --env-file "$LICENSE_ENV" build

echo "==> Starting services"
docker compose -f docker-compose.license.yml --env-file "$LICENSE_ENV" up -d

echo "==> Waiting for license server to become healthy"
HEALTHY=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:80/health" >/dev/null 2>&1 \
     || curl -fsS "http://127.0.0.1:443/health" -k >/dev/null 2>&1 \
     || curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

# ---- 5. Summary ----
ADMIN_PW_FROM_FILE="$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
echo
echo "================================================================"
echo " License server deployed."
echo "================================================================"
echo " Admin URL:   https://$DOMAIN/admin"
echo " Username:    admin"
echo " Password:    $ADMIN_PW_FROM_FILE"
echo
echo " Public key (send to every casino as LICENSE_PUBLIC_KEY_PEM):"
echo "----------------------------------------------------------------"
cat "$KEY_DIR/public.pem"
echo "----------------------------------------------------------------"
echo
if [ "$HEALTHY" -ne 1 ]; then
  echo " WARNING: /health didn't respond yet. Check 'docker compose logs' —"
  echo " Caddy may still be obtaining its TLS certificate."
fi
echo " Save the admin password somewhere safe — it won't be shown again."
echo "================================================================"
