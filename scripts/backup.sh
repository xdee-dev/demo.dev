#!/usr/bin/env bash
# Backup database + uploaded files (Linux/macOS). Cron example (02:30 daily):
#   30 2 * * * cd /opt/rental && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
pg_dump --format=custom --no-owner --file="backups/rental-db-$STAMP.dump" "$DATABASE_URL"
STORAGE="server/${STORAGE_DIR:-./storage}"
[ -d "$STORAGE" ] && tar -czf "backups/rental-files-$STAMP.tar.gz" -C "$STORAGE" .
ls -1t backups/rental-db-*.dump | tail -n +31 | xargs -r rm --
ls -1t backups/rental-files-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm --
echo "Backup selesai: $STAMP"
