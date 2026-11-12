#!/usr/bin/env bash
# FlashSeat: back up the production Postgres (docker-compose.prod.yml) to
# ./backups/flashseat-<UTC timestamp>.sql.gz and delete backups older than 7 days.
#
# Run from anywhere; meant for a daily cron job on the server (docs/deploy-aws.md):
#   15 3 * * * bash /home/ubuntu/FlashSeat/scripts/backup-db.sh >> /home/ubuntu/FlashSeat/backups/backup.log 2>&1
#
# Restore (stops nothing; run on an EMPTY or disposable database, it drops and recreates objects):
#   gunzip -c backups/flashseat-....sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres \
#     sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
#
# Env overrides: BACKUP_DIR (default <repo>/backups), RETENTION_DAYS (default 7),
# COMPOSE_PROJECT_NAME (default: the name in docker-compose.prod.yml).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.prod.yml")

umask 077 # dumps contain personal data: owner-only files
mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/flashseat-$stamp.sql.gz"
partial="$target.partial"
trap 'rm -f "$partial"' EXIT

echo "[backup-db] $(date -u +%FT%TZ) dumping to $target"
# Credentials come from the container's own env (.env.production); nothing secret
# appears on this command line. pipefail makes a pg_dump failure fail the script.
"${COMPOSE[@]}" exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists' \
  | gzip -9 > "$partial"

# A dump with no content means something went wrong even if pg_dump exited 0.
if [ "$(gzip -dc "$partial" 2>/dev/null | head -c 100 | wc -c)" -lt 100 ]; then
  echo "[backup-db] ERROR: dump is empty" >&2
  exit 1
fi
mv "$partial" "$target"
echo "[backup-db] ok: $(du -h "$target" | cut -f1)"

# Retention: delete dumps older than RETENTION_DAYS days (only our own file pattern).
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'flashseat-*.sql.gz' -mtime "+$((RETENTION_DAYS - 1))" -print -delete \
  | sed 's/^/[backup-db] deleted old backup: /'
