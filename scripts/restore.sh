#!/usr/bin/env bash
# Restore into an EMPTY database:  ./scripts/restore.sh backups/rental-db-XXXX.dump [backups/rental-files-XXXX.tar.gz]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" "$1"
if [ "${2:-}" != "" ]; then mkdir -p "server/${STORAGE_DIR:-./storage}"; tar -xzf "$2" -C "server/${STORAGE_DIR:-./storage}"; fi
echo "Restore selesai"
