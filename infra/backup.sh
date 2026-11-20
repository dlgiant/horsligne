#!/usr/bin/env bash
# Backup the append-only JSONL store (incl. the audit log) — run from cron on the VPS.
#   17 3 * * * /srv/horsligne/infra/backup.sh
# Keeps 30 days locally; ship offsite with rclone/S3 (docs/04: audit retained 12 months).
set -euo pipefail

SRC="${HORSLIGNE_DATA_DIR:-/srv/horsligne/backend/data}"
DEST="${HORSLIGNE_BACKUP_DIR:-/var/backups/horsligne}"
KEEP_DAYS=30

mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
tar -czf "${DEST}/horsligne-data-${STAMP}.tar.gz" -C "$(dirname "$SRC")" "$(basename "$SRC")"

# audit log gets its own plain copy for quick inspection/export (LGPD/GDPR requests)
cp "${SRC}/audit.jsonl" "${DEST}/audit-${STAMP}.jsonl" 2>/dev/null || true

find "$DEST" -name 'horsligne-data-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name 'audit-*.jsonl' -mtime +"$KEEP_DAYS" -delete

echo "backed up $(du -h "${DEST}/horsligne-data-${STAMP}.tar.gz" | cut -f1) → ${DEST} (retention ${KEEP_DAYS}d)"
