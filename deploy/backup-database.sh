#!/usr/bin/env bash
set -Eeuo pipefail

env_file="${HCLITE_ENV_FILE:-/etc/hclite.env}"
backup_dir="${HCLITE_BACKUP_DIR:-/opt/hclite-backups/daily}"
retention_days="${HCLITE_BACKUP_RETENTION_DAYS:-7}"

if [[ "$(id -u)" -ne 0 || ! -f "$env_file" || -L "$env_file" ]]; then
  echo "ERROR: run as root with a regular environment file" >&2
  exit 10
fi
if [[ "$backup_dir" != /* || "$backup_dir" == / || ! "$retention_days" =~ ^[0-9]+$ ]]; then
  echo "ERROR: unsafe backup configuration" >&2
  exit 11
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
: "${DATABASE_URL:?DATABASE_URL is not configured}"

install -d -m 0700 -o root -g root "$backup_dir"
exec 9>/run/lock/hclite-db-backup.lock
flock -n 9 || { echo "ERROR: another backup is running" >&2; exit 75; }

umask 077
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$backup_dir/.hclite-$timestamp.dump.tmp"
final="$backup_dir/hclite-$timestamp.dump"
trap 'rm -f -- "$temporary"' EXIT

pg_dump --dbname="$DATABASE_URL" --format=custom --compress=6 --file="$temporary"
pg_restore --list "$temporary" >/dev/null
mv -- "$temporary" "$final"
sha256sum "$final" > "$final.sha256"
find "$backup_dir" -maxdepth 1 -type f -name 'hclite-*.dump' -mtime "+$retention_days" -print0 |
  while IFS= read -r -d '' expired; do rm -f -- "$expired" "$expired.sha256"; done
echo "BACKUP_FILE=$final"
