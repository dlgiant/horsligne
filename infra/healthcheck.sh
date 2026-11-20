#!/usr/bin/env bash
# Healthcheck — run on the VPS (cron every 5 min) or against any base URL:
#   ./infra/healthcheck.sh                 # local backend on :3000
#   API=http://127.0.0.1:3000 ./infra/healthcheck.sh
set -euo pipefail

API="${API:-http://127.0.0.1:3000}"

if ! curl -sf "${API}/api/health" > /dev/null; then
  echo "CRITICAL: ${API}/api/health is not responding"
  exit 1
fi

# prod safety: if an EnvironmentFile exists, warn when required secrets are missing
ENV_FILE="${HORSLIGNE_ENV_FILE:-/etc/horsligne/env}"
if [ -f "$ENV_FILE" ]; then
  for var in SESSION_SECRET REVENUECAT_WEBHOOK_SECRET ADMIN_TOKEN; do
    if ! grep -qE "^${var}=.+" "$ENV_FILE"; then
      echo "WARNING: ${var} is not set in ${ENV_FILE} — prod must have all secrets (infra/secrets.md)"
      exit 2
    fi
  done
fi

echo "OK: ${API}/api/health"
