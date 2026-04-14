#!/usr/bin/env bash
# ============================================================================
# S3 BACKUP PRUNING SCRIPT
# Enforces retention policy: 7 daily, 4 weekly, 12 monthly
#
# Usage:
#   ./scripts/prune_s3_backups.sh              # prune
#   ./scripts/prune_s3_backups.sh --dry-run    # show what would be deleted
#
# Required env vars: BACKUP_S3_BUCKET, AWS_REGION
# ============================================================================
set -euo pipefail

S3_PREFIX="${BACKUP_S3_PREFIX:-compplan}"
BUCKET="${BACKUP_S3_BUCKET:-}"
REGION="${AWS_REGION:-us-east-1}"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

# Retention limits
DAILY_KEEP=7
WEEKLY_KEEP=4
MONTHLY_KEEP=12

log() { echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] $*"; }

if [ -z "$BUCKET" ]; then log "BACKUP_S3_BUCKET not set"; exit 1; fi

prune_folder() {
  local folder="$1"
  local keep="$2"
  local pattern="$3"

  local files
  files=$(aws s3 ls "s3://${BUCKET}/${S3_PREFIX}/${folder}/" --region "$REGION" 2>/dev/null \
    | grep "$pattern" | sort -k1,2 | head -n -"$keep" || true)

  if [ -z "$files" ]; then
    log "  ${folder}: nothing to prune (${keep} or fewer files)"
    return
  fi

  local count
  count=$(echo "$files" | wc -l | tr -d ' ')
  log "  ${folder}: pruning ${count} old file(s), keeping latest ${keep}"

  echo "$files" | while read -r line; do
    local key
    key=$(echo "$line" | awk '{print $4}')
    if [ -z "$key" ]; then continue; fi
    if [ "$DRY_RUN" = true ]; then
      log "    [DRY RUN] Would delete: ${key}"
    else
      aws s3 rm "s3://${BUCKET}/${key}" --region "$REGION" --quiet
      log "    Deleted: ${key}"
      # Also delete checksum
      aws s3 rm "s3://${BUCKET}/${key}.sha256" --region "$REGION" --quiet 2>/dev/null || true
    fi
  done
}

log "=== Backup Pruning ==="
log "Retention: ${DAILY_KEEP} daily, ${WEEKLY_KEEP} weekly, ${MONTHLY_KEEP} monthly"
[ "$DRY_RUN" = true ] && log "[DRY RUN MODE]"

log ""
log "Database backups:"
prune_folder "db/daily" "$DAILY_KEEP" "\.dump\.gz$"
prune_folder "db/weekly" "$WEEKLY_KEEP" "\.dump\.gz$"
prune_folder "db/monthly" "$MONTHLY_KEEP" "\.dump\.gz$"

log ""
log "Code backups:"
prune_folder "code/daily" "$DAILY_KEEP" "\.bundle\.gz$"
prune_folder "code/weekly" "$WEEKLY_KEEP" "\.bundle\.gz$"
prune_folder "code/monthly" "$MONTHLY_KEEP" "\.bundle\.gz$"

log ""
log "=== Pruning Complete ==="
