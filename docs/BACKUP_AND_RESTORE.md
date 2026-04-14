# Backup & Restore Guide

## Architecture Overview

```
                    Nightly (GitHub Actions)
                    ========================
                    
  [Neon PostgreSQL] --pg_dump--> [.dump.gz] --upload--> [AWS S3 Bucket]
  [GitHub Repo]     --git bundle-> [.bundle.gz] --upload--> [AWS S3 Bucket]
  
  S3 Structure:
  s3://bucket/compplan/
    db/
      daily/      (7 kept)
      weekly/     (4 kept)
      monthly/    (12 kept)
      manifests/
    code/
      daily/      (7 kept)
      weekly/     (4 kept)
      monthly/    (12 kept)
```

## What IS Backed Up

| Item | Method | Frequency | Retention |
|------|--------|-----------|-----------|
| All PostgreSQL tables (Neon) | pg_dump custom format | Nightly 02:00 UTC | 7 daily + 4 weekly + 12 monthly |
| Full git repo (all branches, tags) | git bundle | Nightly 02:30 UTC | 7 daily + 4 weekly + 12 monthly |
| Backup checksums (SHA-256) | Generated alongside | Every backup | Same as parent |
| Backup manifests (JSON) | Generated alongside | Every DB backup | Same as parent |

## What is NOT Backed Up

- **Uploaded files** (`uploads/` directory) — not in the database
- **Environment variables** on Render — document these separately
- **Neon branch metadata** — only the data in the production database
- **Local `.env` files** — never committed, keep a separate secure copy
- **Node modules / build artifacts** — reproducible from code

---

## Setup Instructions

### Step 1: Create AWS S3 Bucket

```bash
# Create a private bucket (no public access)
aws s3 mb s3://your-compplan-backups --region eu-west-1

# Block ALL public access
aws s3api put-public-access-block --bucket your-compplan-backups --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Enable versioning (optional, recommended)
aws s3api put-bucket-versioning --bucket your-compplan-backups --versioning-configuration Status=Enabled

# Enable server-side encryption by default
aws s3api put-bucket-encryption --bucket your-compplan-backups --server-side-encryption-configuration \
  '{"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}'
```

### Step 2: Create IAM User for Backups

Create a dedicated IAM user with **minimum permissions**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::your-compplan-backups",
        "arn:aws:s3:::your-compplan-backups/*"
      ]
    }
  ]
}
```

Save the access key and secret key securely.

### Step 3: Configure GitHub Secrets

Go to **GitHub > Repo Settings > Secrets and variables > Actions** and add:

| Secret | Value |
|--------|-------|
| `DATABASE_URL_BACKUP_SOURCE` | Neon **non-pooled** connection string |
| `BACKUP_S3_BUCKET` | `your-compplan-backups` |
| `BACKUP_S3_PREFIX` | `compplan` |
| `AWS_REGION` | `eu-west-1` |
| `BACKUP_AWS_ACCESS_KEY_ID` | IAM user access key |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `SECONDARY_GIT_REMOTE_URL` | (Optional) URL of mirror repo |

### Step 4: Verify Setup

Trigger manually from GitHub Actions tab:
1. Go to **Actions > Nightly Database Backup > Run workflow**
2. Go to **Actions > Nightly Code Backup > Run workflow**
3. Check the logs for success

---

## Manual Operations

### Run DB Backup Manually (from your laptop)

```bash
# Load env vars
source .env.backup

# Full backup with S3 upload
./scripts/backup_db.sh

# Local only (no S3)
./scripts/backup_db.sh --skip-upload

# See what would happen
./scripts/backup_db.sh --dry-run
```

### Run Code Backup Manually

```bash
source .env.backup
./scripts/backup_code.sh
```

### Verify Backups Exist

```bash
source .env.backup
./scripts/verify_backup.sh
```

### Prune Old Backups

```bash
source .env.backup

# See what would be deleted
./scripts/prune_s3_backups.sh --dry-run

# Actually prune
./scripts/prune_s3_backups.sh
```

---

## Restore Procedures

### Restore Database

```bash
source .env.backup

# List available backups
./scripts/restore_db.sh --list-s3

# Restore the latest backup into a TEST database
export DATABASE_URL_RESTORE_TARGET="postgresql://user:pass@localhost:5432/compplan_test"
./scripts/restore_db.sh --latest

# Restore a specific backup
./scripts/restore_db.sh s3://your-bucket/compplan/db/daily/compplan_db_20260414_020000.dump.gz

# Restore from a local file
./scripts/restore_db.sh /path/to/compplan_db_20260414.dump.gz
```

**To restore into PRODUCTION:**
```bash
# DANGER: This overwrites production data
export DATABASE_URL_RESTORE_TARGET="$DATABASE_URL_BACKUP_SOURCE"
./scripts/restore_db.sh --latest
# You will be asked to type 'yes' to confirm
```

### Restore Code from Bundle

```bash
# Download the bundle from S3
aws s3 cp s3://your-bucket/compplan/code/daily/compplan_code_20260414.bundle.gz /tmp/

# Decompress
gunzip /tmp/compplan_code_20260414.bundle.gz

# Clone from the bundle (creates a new directory)
git clone /tmp/compplan_code_20260414.bundle compplan-restored

# Or restore into existing repo
cd compplan-restored
git bundle verify /tmp/compplan_code_20260414.bundle
git fetch /tmp/compplan_code_20260414.bundle --all
```

---

## Monthly Restore Test Procedure

Run this once a month to confirm backups are actually restorable:

1. **Create a test Neon branch** or use a local PostgreSQL
2. Run: `DATABASE_URL_RESTORE_TARGET=<test_db_url> ./scripts/restore_db.sh --latest`
3. Connect to the test database and verify: `SELECT count(*) FROM employees; SELECT count(*) FROM pricing_cases;`
4. Run: `./scripts/verify_backup.sh`
5. Delete the test branch/database
6. Document the test date and result

---

## Common Failure Cases

| Symptom | Cause | Fix |
|---------|-------|-----|
| `pg_dump: connection refused` | Wrong connection string or Neon is down | Verify `DATABASE_URL_BACKUP_SOURCE` is the non-pooled URL |
| `Upload failed: Access Denied` | IAM permissions wrong | Check the S3 bucket policy and IAM user permissions |
| `No backups found` | Workflow never ran | Check GitHub Actions for errors, verify secrets are set |
| `Checksum mismatch` | Corrupted download | Re-download from S3, check network |
| Backup is 0 bytes | Empty database or pg_dump failure | Check the workflow logs for errors |

## Credential Rotation

When rotating credentials:

1. **Neon password**: Update in Neon Console, then update `DATABASE_URL_BACKUP_SOURCE` in GitHub Secrets + Render env vars
2. **AWS keys**: Create new IAM key pair, update GitHub Secrets, delete old key pair
3. **Harvest token**: Generate new token in Harvest, update `HARVEST_TOKEN` in Render env vars
4. **GitHub token**: If using PAT for mirror, regenerate and update `SECONDARY_GIT_REMOTE_URL`

**Always update the secret in ALL places before revoking the old one.**

---

## S3 Lifecycle Rules (Recommended)

Add this lifecycle rule to your S3 bucket for additional cost optimization:

```json
{
  "Rules": [
    {
      "ID": "BackupRetention",
      "Status": "Enabled",
      "Filter": { "Prefix": "compplan/" },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        }
      ],
      "Expiration": {
        "Days": 400
      }
    }
  ]
}
```

This moves backups to cheaper storage over time and auto-deletes after ~13 months.
