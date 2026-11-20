#!/usr/bin/env bash
# Deploy Hors Ligne to a VPS. Zero deps beyond ssh/rsync.
#   ./infra/deploy.sh <user@host> [prod|staging]
# Requires: /srv/horsligne on the host, systemd unit + EnvironmentFile already
# installed (see infra/README.md "First-time server setup").
set -euo pipefail

HOST="${1:?usage: deploy.sh <user@host> [prod|staging]}"
ENV_NAME="${2:-prod}"
REMOTE_DIR=/srv/horsligne

echo "==> rsync repo → ${HOST}:${REMOTE_DIR} (excluding .git, data, build artifacts)"
rsync -az --delete \
  --exclude .git \
  --exclude 'backend/data' \
  --exclude 'node_modules' \
  --exclude 'app/build' \
  --exclude '.env*' \
  --exclude '.DS_Store' \
  ./ "${HOST}:${REMOTE_DIR}/"

echo "==> restart backend + healthcheck"
ssh "${HOST}" "sudo systemctl restart horsligne-backend && sleep 1 && ${REMOTE_DIR}/infra/healthcheck.sh"

echo "==> deployed (${ENV_NAME}) ✔  https://api.horslign.earth/api/health"
