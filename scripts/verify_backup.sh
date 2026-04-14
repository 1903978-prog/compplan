#!/usr/bin/env bash
# ============================================================================
# BACKUP VERIFICATION SCRIPT
# Checks that recent backups exist in S3 and are valid
#
# Usage: ./scripts/verify_backup.sh
# Required env vars: BACKUP_S3_BUCKET, AWS_REGION
# ============================================================================
set -euo pipefail

S3_PREFIX="${BACKUP_S3_PREFIX:-compplan}"
BUCKET="${BACKUP_S3_BUCKET:-}"
REGION="${AWS_REGION:-us-east-1}"

log() { echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] $*"; }
err() { echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] ERROR: $*" >&2; }
pass() { echo "  [PASS] $*"; }
fail() { echo "  [FAIL] $*"; FAILURES=$((FAILURES + 1)); }

FAILURES=0

if [ -z "$BUCKET" ]; then err "BACKUP_S3_BUCKET not set"; exit 1; fi
if ! command -v aws &>/dev/null; then err "AWS CLI not found"; exit 1; fi

log "=== Backup Verification ==="
log "Bucket: s3://${BUCKET}/${S3_PREFIX}/"

# ── Check DB backups ────────────────────────────────────────────────────────
log ""
log "Database backups (last 7 days):"
DB_FILES=$(aws s3 ls "s3://${BUCKET}/${S3_PREFIX}/db/" --recursive --region "$REGION" 2>/dev/null \
  | grep "\.dump\.gz$" | sort -k1,2 | tail -7)

if [ -z "$DB_FILES" ]; then
  fail "No database backups found"
else
  DB_COUNT=$(echo "$DB_FILES" | wc -l | tr -d ' ')
  pass "${DB_COUNT} database backup(s) found"
  echo "$DB_FILES" | while read -r line; do
    SIZE=$(echo "$line" | awk '{print $3}')
    FILE=$(echo "$line" | awk '{print $4}')
    DATE=$(echo "$line" | awk '{print $1, $2}')
    if [ "${SIZE:-0}" -lt 1000 ]; then
      fail "  Suspiciously small: ${FILE} (${SIZE} bytes)"
    else
      echo "    ${DATE}  $(numfmt --to=iec ${SIZE} 2>/dev/null || echo "${SIZE}B")  ${FILE##*/}"
    fi
  done

  # Check latest is within 25 hours
  LATEST_DATE=$(echo "$DB_FILES" | tail -1 | awk '{print $1"T"$2}')
  if [ -n "$LATEST_DATE" ]; then
    LATEST_EPOCH=$(date -d "$LATEST_DATE" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "$LATEST_DATE" +%s 2>/dev/null || echo "0")
    NOW_EPOCH=$(date +%s)
    AGE_HOURS=$(( (NOW_EPOCH - LATEST_EPOCH) / 3600 ))
    if [ "$AGE_HOURS" -gt 25 ]; then
      fail "Latest DB backup is ${AGE_HOURS}h old (expected <25h)"
    else
      pass "Latest DB backup is ${AGE_HOURS}h old"
    fi
  fi
fi

# ── Check code backups ──────────────────────────────────────────────────────
log ""
log "Code backups (last 7 days):"
CODE_FILES=$(aws s3 ls "s3://${BUCKET}/${S3_PREFIX}/code/" --recursive --region "$REGION" 2>/dev/null \
  | grep "\.bundle\.gz$" | sort -k1,2 | tail -7)

if [ -z "$CODE_FILES" ]; then
  fail "No code backups found"
else
  CODE_COUNT=$(echo "$CODE_FILES" | wc -l | tr -d ' ')
  pass "${CODE_COUNT} code backup(s) found"
  echo "$CODE_FILES" | while read -r line; do
    SIZE=$(echo "$line" | awk '{print $3}')
    FILE=$(echo "$line" | awk '{print $4}')
    DATE=$(echo "$line" | awk '{print $1, $2}')
    echo "    ${DATE}  $(numfmt --to=iec ${SIZE} 2>/dev/null || echo "${SIZE}B")  ${FILE##*/}"
  done
fi

# ── Check retention structure ───────────────────────────────────────────────
log ""
log "Retention structure:"
for type in daily weekly monthly; do
  DB_N=$(aws s3 ls "s3://${BUCKET}/${S3_PREFIX}/db/${type}/" --region "$REGION" 2>/dev/null | grep "\.dump\.gz$" | wc -l | tr -d ' ')
  CODE_N=$(aws s3 ls "s3://${BUCKET}/${S3_PREFIX}/code/${type}/" --region "$REGION" 2>/dev/null | grep "\.bundle\.gz$" | wc -l | tr -d ' ')
  echo "  ${type}: ${DB_N} DB backups, ${CODE_N} code backups"
done

# ── Summary ─────────────────────────────────────────────────────────────────
log ""
if [ $FAILURES -eq 0 ]; then
  log "=== All checks PASSED ==="
  exit 0
else
  err "=== ${FAILURES} check(s) FAILED ==="
  exit 1
fi
