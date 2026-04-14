#!/usr/bin/env bash
# ============================================================================
# CODE BACKUP SCRIPT — Git repository mirror + S3 archive
# Creates a full mirror (all branches, tags) and optionally uploads to S3
#
# Usage:
#   ./scripts/backup_code.sh                  # mirror + S3 upload
#   ./scripts/backup_code.sh --skip-upload    # mirror locally only
#   ./scripts/backup_code.sh --dry-run        # show what would happen
#
# Optional env vars: SECONDARY_GIT_REMOTE_URL, BACKUP_S3_BUCKET, AWS_REGION
# ============================================================================
set -euo pipefail

TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
DAY_OF_MONTH=$(date -u +"%d")
DAY_OF_WEEK=$(date -u +"%u")
BACKUP_DIR="/tmp/compplan_code_backup"
BUNDLE_FILE="${BACKUP_DIR}/compplan_code_${TIMESTAMP}.bundle"
COMPRESSED_FILE="${BUNDLE_FILE}.gz"
CHECKSUM_FILE="${COMPRESSED_FILE}.sha256"
S3_PREFIX="${BACKUP_S3_PREFIX:-compplan}"

DRY_RUN=false
SKIP_UPLOAD=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --skip-upload) SKIP_UPLOAD=true ;;
  esac
done

log() { echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] $*"; }
err() { echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] ERROR: $*" >&2; }

# ── Validate ────────────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then err "git not found"; exit 1; fi

# ── Determine S3 path ──────────────────────────────────────────────────────
get_s3_path() {
  local type="daily"
  if [ "$DAY_OF_MONTH" = "01" ]; then type="monthly"
  elif [ "$DAY_OF_WEEK" = "7" ]; then type="weekly"; fi
  echo "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/code/${type}/compplan_code_${TIMESTAMP}.bundle.gz"
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
  log "=== Code Backup Started ==="

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would create git bundle at ${BUNDLE_FILE}"
    [ -n "${SECONDARY_GIT_REMOTE_URL:-}" ] && log "[DRY RUN] Would push mirror to secondary remote"
    [ "$SKIP_UPLOAD" = false ] && [ -n "${BACKUP_S3_BUCKET:-}" ] && log "[DRY RUN] Would upload to $(get_s3_path)"
    exit 0
  fi

  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  # Step 1: Git bundle (includes ALL branches and tags)
  log "Step 1: Creating git bundle (all refs)..."
  # Find repo root
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  cd "$REPO_ROOT"

  git bundle create "$BUNDLE_FILE" --all
  if [ ! -f "$BUNDLE_FILE" ] || [ ! -s "$BUNDLE_FILE" ]; then
    err "Git bundle creation failed"
    exit 1
  fi
  log "  Bundle created: $(du -h "$BUNDLE_FILE" | awk '{print $1}')"

  # Step 2: Compress
  log "Step 2: Compressing..."
  gzip -9 "$BUNDLE_FILE"
  log "  Compressed: $(du -h "$COMPRESSED_FILE" | awk '{print $1}')"

  # Step 3: Checksum
  log "Step 3: Checksum..."
  sha256sum "$COMPRESSED_FILE" > "$CHECKSUM_FILE"
  log "  SHA-256: $(awk '{print $1}' "$CHECKSUM_FILE")"

  # Step 4: Push to secondary remote (optional)
  if [ -n "${SECONDARY_GIT_REMOTE_URL:-}" ]; then
    log "Step 4a: Pushing mirror to secondary remote..."
    # Add/update the backup remote
    git remote remove backup-mirror 2>/dev/null || true
    git remote add backup-mirror "$SECONDARY_GIT_REMOTE_URL"
    git push backup-mirror --mirror 2>&1 | tail -5
    git remote remove backup-mirror
    log "  Mirror push complete"
  fi

  # Step 5: Upload to S3 (optional)
  if [ "$SKIP_UPLOAD" = false ] && [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    S3_PATH=$(get_s3_path)
    log "Step 5: Uploading to S3: ${S3_PATH}"
    aws s3 cp "$COMPRESSED_FILE" "$S3_PATH" \
      --region "${AWS_REGION:-us-east-1}" --sse AES256 --no-progress
    aws s3 cp "$CHECKSUM_FILE" "${S3_PATH}.sha256" \
      --region "${AWS_REGION:-us-east-1}" --sse AES256 --no-progress
    log "  Upload complete"
    rm -f "$COMPRESSED_FILE" "$CHECKSUM_FILE" 2>/dev/null || true
  else
    log "Step 5: S3 upload skipped"
    log "  Local file: ${COMPRESSED_FILE}"
  fi

  log "=== Code Backup Completed Successfully ==="
}

main "$@"
