#!/usr/bin/env bash
# Git-based deploy for the self-hosted zoomphone-bridge.
#
# Runs ON the `home` box, as the service user. Replaces the old `tar | ssh` push:
# fetch + hard-reset the checkout to a ref, install deps, restart the user
# systemd service, then wait for /health.
#
# No passwordless sudo is used (user systemd only). Secrets stay in the box's
# .env and are never read or printed here.
#
# Usage (on the box):
#   ~/apps/zoomphone-bridge/scripts/deploy.sh
#   DEPLOY_REF=origin/main ~/apps/zoomphone-bridge/scripts/deploy.sh
#   DEPLOY_REF=v3.1.0      ~/apps/zoomphone-bridge/scripts/deploy.sh
#
# Env knobs (all optional):
#   DEPLOY_REF   git ref to deploy        (default: origin/main)
#   SERVICE      systemd --user unit name (default: zoomphone-bridge)
#   HEALTH_URL   health endpoint          (default: http://127.0.0.1:8787/health)
#   APP_DIR      app directory            (default: dir two levels up from this script)

set -euo pipefail

DEPLOY_REF="${DEPLOY_REF:-origin/main}"
SERVICE="${SERVICE:-zoomphone-bridge}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8787/health}"

# Resolve the app dir as the parent of scripts/ unless overridden.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
APP_DIR="${APP_DIR:-$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)}"

# systemctl --user needs this on a non-login (bare-SSH) shell.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mDEPLOY FAILED:\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "app dir not found: $APP_DIR"
[ -d .git ] || git rev-parse --is-inside-work-tree >/dev/null 2>&1 || \
  die "$APP_DIR is not a git checkout"

log "Deploying ${SERVICE} from ${DEPLOY_REF} in ${APP_DIR}"

# 1. Sync the checkout to the target ref (clean, reproducible — no local drift).
log "git fetch + reset --hard ${DEPLOY_REF}"
git fetch --prune origin
git reset --hard "$DEPLOY_REF"
git --no-pager log -1 --oneline

# 2. Install deps (no build step: tsx runs the TS directly).
log "npm install"
if [ -f package-lock.json ]; then
  npm ci --omit=dev || npm install --omit=dev
else
  npm install --omit=dev
fi

# 3. Restart the user service.
log "systemctl --user restart ${SERVICE}"
systemctl --user daemon-reload || true
systemctl --user restart "$SERVICE"

# 4. Wait for /health to come back green.
log "waiting for ${HEALTH_URL}"
ok=""
for i in $(seq 1 30); do
  if body="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null)" && [ "$body" = "ok" ]; then
    ok=1
    break
  fi
  sleep 1
done
[ -n "$ok" ] || {
  printf '\n--- recent service logs ---\n' >&2
  journalctl --user -u "$SERVICE" -n 40 --no-pager >&2 || true
  die "service did not report healthy at ${HEALTH_URL}"
}

log "Deployed. ${SERVICE} is healthy."
