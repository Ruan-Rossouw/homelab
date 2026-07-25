#!/usr/bin/env bash
# Backs up /DATA/Media and /DATA/AppData into the restic repository on
# /DATA/Backup, then prunes old snapshots per the retention policy.
#
# Runs restic as a Docker container (restic/restic) rather than a native
# binary — ZimaOS has no package manager and a read-only root, so a native
# install isn't possible. See docs/zimaos.md.
#
# Requires scripts/backup.env (copy scripts/backup.env.example, fill in a
# real password). Intended to run unattended via the systemd timer in
# scripts/systemd/ — see docs/backup.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/backup.env"
RESTIC_IMAGE="restic/restic:0.17.3"

MEDIA_SRC="/DATA/Media"
APPDATA_SRC="/DATA/AppData"
BACKUP_DEST="/DATA/Backup"

# Retention: 7 daily, 4 weekly, 6 monthly. See docs/backup.md for reasoning.
KEEP_ARGS=(--keep-daily 7 --keep-weekly 4 --keep-monthly 6)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE} — copy backup.env.example and fill in a real password." >&2
  exit 1
fi

echo "==> restic backup: ${MEDIA_SRC}, ${APPDATA_SRC} -> ${BACKUP_DEST}"
docker run --rm \
  --env-file "$ENV_FILE" \
  -v "${MEDIA_SRC}:/data/media:ro" \
  -v "${APPDATA_SRC}:/data/appdata:ro" \
  -v "${BACKUP_DEST}:/backup" \
  "$RESTIC_IMAGE" backup /data/media /data/appdata --tag scheduled

echo "==> restic forget --prune"
docker run --rm \
  --env-file "$ENV_FILE" \
  -v "${BACKUP_DEST}:/backup" \
  "$RESTIC_IMAGE" forget "${KEEP_ARGS[@]}" --prune

echo "==> done"
