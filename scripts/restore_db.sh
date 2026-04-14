#!/usr/bin/env bash
# ============================================================================
# DATABASE RESTORE SCRIPT
# Restores a pg_dump backup into a target database
#
# Usage:
#   ./scripts/restore_db.sh <path_or_s3_url>
#   ./scripts/restore_db.sh /tmp/compplan_backups/compplan_db_20260414.dump.gz
#   ./scripts/restore_db.sh s3://bucket/compplan/db/daily/compplan_db_20260414.dump.gz
#   ./scripts/restore_db.sh --list-s3              # list available S3 backups
#   ./scripts/restore_db.sh --latest               # restore the latest S3 backup
#
# IMPORTANT: This restores into DATABASE_URL_RESTORE_TARGET, NOT production.
# To restore into production, explicitly set DATABASE_URL_RESTORE_TARGET to
# the production connection string. This is intentionally a manual step.
#
# Required env vars: DATABASE_URL_RESTORE_TARGET
# Optional: BACKUP_S3_BUCKET, AWS_REGION (for S3 downloads)
# ============================================================================
set -euo pipefail

BACKUP_DIR="/tmp/compplan_restore"
S3_PREFIX="${BACKUP_S3_PREFIX:-compplan}"

log() { echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] $*"; }
err() { echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] ERROR: $*" >&2; }

# ── Validate ────────────────────────────────────────────────────────────────
if [ -z "${DATABASE_URL_RESTORE_TARGET:-}" ]; then
  err "DATABASE_URL_RESTORE_TARGET is not set."
  err "This is a safety measure. Set it to the database you want to restore INTO."
  err "For production restore: export DATABASE_URL_RESTORE_TARGET=\$DATABASE_URL_BACKUP_SOURCE"
  exit 1
fi

# ── List available S3 backups ───────────────────────────────────────────────
if [ "${1:-}" = "--list-s3" ]; then
  if [ -z "${BACKUP_S3_BUCKET:-}" ]; then err "BACKUP_S3_BUCKET not set"; exit 1; fi
  log "Available backups in s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/db/:"
  aws s3 ls "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/db/" --recursive --region "${AWS_REGION:-us-east-1}" \
    | grep "\.dump\.gz$" | sort -k1,2 | tail -30
  exit 0
fi

# ── Find latest S3 backup ──────────────────────────────────────────────────
if [ "${1:-}" = "--latest" ]; then
  if [ -z "${BACKUP_S3_BUCKET:-}" ]; then err "BACKUP_S3_BUCKET not set"; exit 1; fi
  LATEST=$(aws s3 ls "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/db/" --recursive --region "${AWS_REGION:-us-east-1}" \
    | grep "\.dump\.gz$" | sort -k1,2 | tail -1 | awk '{print $4}')
  if [ -z "$LATEST" ]; then err "No backups found in S3"; exit 1; fi
  SOURCE="s3://${BACKUP_S3_BUCKET}/${LATEST}"
  log "Latest backup: ${SOURCE}"
else
  SOURCE="${1:-}"
fi

if [ -z "$SOURCE" ]; then
  err "Usage: $0 <path_or_s3_url> | --list-s3 | --latest"
  exit 1
fi

# ── Download from S3 if needed ──────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

LOCAL_FILE="$SOURCE"
if [[ "$SOURCE" == s3://* ]]; then
  LOCAL_FILE="${BACKUP_DIR}/$(basename "$SOURCE")"
  log "Downloading from S3: ${SOURCE}"
  aws s3 cp "$SOURCE" "$LOCAL_FILE" --region "${AWS_REGION:-us-east-1}" --no-progress

  # Verify checksum if available
  CHECKSUM_S3="${SOURCE}.sha256"
  CHECKSUM_LOCAL="${LOCAL_FILE}.sha256"
  if aws s3 cp "$CHECKSUM_S3" "$CHECKSUM_LOCAL" --region "${AWS_REGION:-us-east-1}" --no-progress 2>/dev/null; then
    log "Verifying checksum..."
    EXPECTED=$(cat "$CHECKSUM_LOCAL" | awk '{print $1}')
    ACTUAL=$(sha256sum "$LOCAL_FILE" | awk '{print $1}')
    if [ "$EXPECTED" != "$ACTUAL" ]; then
      err "CHECKSUM MISMATCH! Backup may be corrupted."
      err "Expected: ${EXPECTED}"
      err "Actual:   ${ACTUAL}"
      exit 1
    fi
    log "  Checksum verified OK"
    rm -f "$CHECKSUM_LOCAL"
  else
    log "  No checksum file found (skipping verification)"
  fi
fi

if [ ! -f "$LOCAL_FILE" ]; then
  err "File not found: ${LOCAL_FILE}"
  exit 1
fi

# ── Decompress if needed ───────────────────────────────────────────────────
DUMP_FILE="$LOCAL_FILE"
if [[ "$LOCAL_FILE" == *.gz ]]; then
  log "Decompressing..."
  DUMP_FILE="${LOCAL_FILE%.gz}"
  gunzip -k "$LOCAL_FILE"
fi

# ── Restore ─────────────────────────────────────────────────────────────────
log "=== RESTORING DATABASE ==="
log "Source: ${DUMP_FILE}"
log "Target: [connection string hidden for security]"
log ""
log "WARNING: This will OVERWRITE data in the target database."
read -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  log "Restore cancelled."
  exit 0
fi

log "Running pg_restore..."
pg_restore \
  --no-password \
  --clean \
  --if-exists \
  --verbose \
  --dbname="$DATABASE_URL_RESTORE_TARGET" \
  "$DUMP_FILE" 2>&1 | tail -5

log "=== Restore Completed ==="
log "Verify your data is correct before using this database."

# ── Cleanup ─────────────────────────────────────────────────────────────────
rm -f "$DUMP_FILE" "${LOCAL_FILE}" 2>/dev/null || true
log "Temp files cleaned up."
