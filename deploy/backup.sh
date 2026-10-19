#!/usr/bin/env bash
# Consistent copy of the SQLite database, safe while the API is running.
# Keeps KEEP_DAYS days of gzipped copies; with BACKUP_REMOTE set, also copies them off the server
# (e.g. BACKUP_REMOTE=u123456@u123456.your-storagebox.de:kquiz, rsync over ssh port 23).
set -euo pipefail

DATA=${KQUIZ_DATA:-/srv/kquiz/data}
DEST=${KQUIZ_BACKUPS:-/srv/kquiz/backups}
KEEP_DAYS=${KEEP_DAYS:-30}

[ -f "$DATA/kquiz.db" ] || { echo "No database at $DATA/kquiz.db yet, nothing to back up"; exit 0; }
mkdir -p "$DEST"
chmod 700 "$DEST"
stamp=$(date -u +%Y%m%d-%H%M%S)
tmp="$DEST/.kquiz-$stamp.db"
trap 'rm -f "$tmp"' EXIT

sqlite3 "$DATA/kquiz.db" ".backup '$tmp'"
[ "$(sqlite3 "$tmp" 'PRAGMA integrity_check')" = ok ] || { echo "Backup failed integrity check" >&2; exit 1; }
gzip -9 -c "$tmp" > "$DEST/kquiz-$stamp.db.gz"
find "$DEST" -name 'kquiz-*.db.gz' -mtime "+$KEEP_DAYS" -delete
echo "Saved $DEST/kquiz-$stamp.db.gz"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a --delete -e "ssh -p ${BACKUP_REMOTE_PORT:-23} -o BatchMode=yes" --include 'kquiz-*.db.gz' --exclude '*' \
    "$DEST/" "$BACKUP_REMOTE/"
fi
