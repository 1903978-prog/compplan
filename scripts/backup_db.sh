#!/usr/bin/env bash
# ============================================================================
# DATABASE BACKUP SCRIPT — Neon PostgreSQL
# Performs pg_dump, compresses, checksums, uploads to S3
#
# Usage:
#   ./scripts/backup_db.sh                    # full backup
#   ./scripts/backup_db.sh --dry-run          # show what would happen
#   ./scripts/backup_db.sh --skip-upload      # dump locally, don't upload
#
# Required env vars: DATABASE_URL_BACKUP_SOURCE, BACKUP_S3_BUCKET, AWS_REGION
# Optional env vars: BACKUP_S3_PREFIX, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# ============================================================================
set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
DAY_OF_WEEK=$(date -u +"%u")  # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date -u +"%d")
BACKUP_DIR="/tmp/compplan_backups"
DUMP_FILE="${BACKUP_DIR}/compplan_db_${TIMESTAMP}.dump"
COMPRESSED_FILE="${DUMP_FILE}.gz"
CHECKSUM_FILE="${COMPRESSED_FILE}.sha256"
MANIFEST_FILE="${BACKUP_DIR}/manifest_${TIMESTAMP}.json"

S3_PREFIX="${BACKUP_S3_PREFIX:-compplan}"

DRY_RUN=false
SKIP_UPLOAD=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --skip-upload) SKIP_UPLOAD=true ;;
  esac
done

# ── Logging ─────────────────────────────────────────────────────────────────
log() { echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] $*"; }
err() { echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] ERROR: $*" >&2; }

# ── Validate prerequisites ──────────────────────────────────────────────────
validate() {
  local missing=0
  for cmd in pg_dump gzip sha256sum; do
    if ! command -v "$cmd" &>/dev/null; then
      err "Required command not found: $cmd"
      missing=1
    fi
  done
  if [ "$SKIP_UPLOAD" = false ]; then
    if ! command -v aws &>/dev/null; then
      err "AWS CLI not found. Install it or use --skip-upload"
      missing=1
    fi
  fi
  if [ -z "${DATABASE_URL_BACKUP_SOURCE:-}" ]; then
    err "DATABASE_URL_BACKUP_SOURCE is not set"
    missing=1
  fi
  if [ "$SKIP_UPLOAD" = false ]; then
    if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
      err "BACKUP_S3_BUCKET is not set"
      missing=1
    fi
    if [ -z "${AWS_REGION:-}" ]; then
      err "AWS_REGION is not set"
      missing=1
    fi
  fi
  if [ $missing -ne 0 ]; then
    err "Aborting due to missing prerequisites"
    exit 1
  fi
}

# ── Cleanup function (always runs) ─────────────────────────────────────────
cleanup() {
  # Remove uncompressed dump (compressed version stays if upload failed)
  rm -f "$DUMP_FILE" 2>/dev/null || true
  # Security: set restrictive permissions on any remaining files
  chmod 600 "${BACKUP_DIR}"/*.gz "${BACKUP_DIR}"/*.sha256 2>/dev/null || true
}
trap cleanup EXIT

# ── Determine S3 path (daily/weekly/monthly retention) ─────────────────────
get_s3_path() {
  local type="daily"
  # First of month = monthly backup
  if [ "$DAY_OF_MONTH" = "01" ]; then
    type="monthly"
  # Sunday = weekly backup
  elif [ "$DAY_OF_WEEK" = "7" ]; then
    type="weekly"
  fi
  echo "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/db/${type}/compplan_db_${TIMESTAMP}.dump.gz"
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
  log "=== Database Backup Started ==="
  validate

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would dump database to ${DUMP_FILE}"
    log "[DRY RUN] Would compress to ${COMPRESSED_FILE}"
    log "[DRY RUN] Would upload to $(get_s3_path)"
    log "[DRY RUN] No actions taken."
    exit 0
  fi

  # Create backup directory with restrictive permissions
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  # Step 1: pg_dump (custom format for selective restore)
  log "Step 1/4: Running pg_dump..."
  # SECURITY: connection string is passed via env var, never echoed
  pg_dump \
    --no-password \
    --format=custom \
    --verbose \
    --file="$DUMP_FILE" \
    "$DATABASE_URL_BACKUP_SOURCE" 2>&1 | grep -v "^pg_dump:" || true

  if [ ! -f "$DUMP_FILE" ] || [ ! -s "$DUMP_FILE" ]; then
    err "pg_dump produced no output or failed"
    exit 1
  fi
  DUMP_SIZE=$(stat -f%z "$DUMP_FILE" 2>/dev/null || stat -c%s "$DUMP_FILE" 2>/dev/null || echo "unknown")
  log "  Dump size: ${DUMP_SIZE} bytes"

  # Step 2: Compress
  log "Step 2/4: Compressing..."
  gzip -9 "$DUMP_FILE"
  COMPRESSED_SIZE=$(stat -f%z "$COMPRESSED_FILE" 2>/dev/null || stat -c%s "$COMPRESSED_FILE" 2>/dev/null || echo "unknown")
  log "  Compressed size: ${COMPRESSED_SIZE} bytes"

  # Step 3: Checksum
  log "Step 3/4: Generating SHA-256 checksum..."
  sha256sum "$COMPRESSED_FILE" > "$CHECKSUM_FILE"
  CHECKSUM=$(cat "$CHECKSUM_FILE" | awk '{print $1}')
  log "  SHA-256: ${CHECKSUM}"

  # Step 4: Upload to S3
  if [ "$SKIP_UPLOAD" = true ]; then
    log "Step 4/4: Upload skipped (--skip-upload)"
    log "  Local file: ${COMPRESSED_FILE}"
  else
    S3_PATH=$(get_s3_path)
    S3_CHECKSUM_PATH="${S3_PATH}.sha256"
    log "Step 4/4: Uploading to S3..."
    log "  Destination: ${S3_PATH}"

    aws s3 cp "$COMPRESSED_FILE" "$S3_PATH" \
      --region "${AWS_REGION}" \
      --sse AES256 \
      --no-progress

    aws s3 cp "$CHECKSUM_FILE" "$S3_CHECKSUM_PATH" \
      --region "${AWS_REGION}" \
      --sse AES256 \
      --no-progress

    log "  Upload complete"

    # Generate manifest
    cat > "$MANIFEST_FILE" <<MANIFEST
{
  "timestamp": "${TIMESTAMP}",
  "type": "database",
  "s3_path": "${S3_PATH}",
  "checksum_sha256": "${CHECKSUM}",
  "compressed_size_bytes": ${COMPRESSED_SIZE:-0},
  "status": "success"
}
MANIFEST
    aws s3 cp "$MANIFEST_FILE" "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/db/manifests/manifest_${TIMESTAMP}.json" \
      --region "${AWS_REGION}" --sse AES256 --no-progress 2>/dev/null || true

    # Clean up local files after successful upload
    rm -f "$COMPRESSED_FILE" "$CHECKSUM_FILE" "$MANIFEST_FILE" 2>/dev/null || true
    log "  Local temp files cleaned up"
  fi

  log "=== Database Backup Completed Successfully ==="
}

main "$@"
