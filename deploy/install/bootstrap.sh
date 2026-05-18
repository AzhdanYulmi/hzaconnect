#!/usr/bin/env bash
# One-liner bootstrap for hzaconnect. Downloads the deploy bundle to
# $INSTALL_DIR (default /opt/hzaconnect), then runs install.sh with any
# remaining flags.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AzhdanYulmi/hzaconnect/main/deploy/install/bootstrap.sh | sudo bash -s -- \
#     --domain chat.acme.com --token <LICENSE> --admin-email me@acme.com
#
# Or pin to a release:
#   curl -fsSL https://raw.githubusercontent.com/AzhdanYulmi/hzaconnect/main/deploy/install/bootstrap.sh | sudo bash -s -- \
#     --release v1.2.3 --domain ...

set -euo pipefail

OWNER="AzhdanYulmi"
REPO="hzaconnect"
INSTALL_DIR="${HZA_INSTALL_DIR:-/opt/hzaconnect}"
RELEASE=""   # empty = main
INSTALL_FLAGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --release)     RELEASE="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    *)             INSTALL_FLAGS+=("$1"); shift ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "curl required" >&2; exit 1; }
command -v tar  >/dev/null 2>&1 || { echo "tar required" >&2; exit 1; }

echo "==> Installing hzaconnect deploy bundle to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ -n "$RELEASE" ]; then
  TARBALL="https://github.com/$OWNER/$REPO/releases/download/$RELEASE/hzaconnect-deploy-$RELEASE.tar.gz"
  echo "==> Downloading $TARBALL"
  curl -fsSL "$TARBALL" | tar -xz
else
  # Fetch individual files from the main branch raw URLs. Avoids needing a
  # release artifact for unreleased / dev installs.
  BASE="https://raw.githubusercontent.com/$OWNER/$REPO/main/deploy/install"
  echo "==> Fetching bundle files from $BASE"
  for f in install.sh update.sh doctor.sh hzaconnect Caddyfile docker-compose.deploy.yml .env.example; do
    curl -fsSL "$BASE/$f" -o "$f"
  done
fi

chmod +x install.sh update.sh doctor.sh hzaconnect

# Symlink so `hzaconnect` works from any pwd
if [ -w /usr/local/bin ] || [ "$(id -u)" -eq 0 ]; then
  ln -sf "$INSTALL_DIR/hzaconnect" /usr/local/bin/hzaconnect
  echo "==> Linked /usr/local/bin/hzaconnect"
else
  echo "==> NOTE: /usr/local/bin not writable. Add this to your shell rc:"
  echo "         alias hzaconnect=\"$INSTALL_DIR/hzaconnect\""
fi

echo "==> Running installer"
exec ./install.sh "${INSTALL_FLAGS[@]}"
