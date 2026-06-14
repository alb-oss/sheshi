#!/usr/bin/env bash
set -euo pipefail

ROOT="${SHESHI_ROOT:-/opt/sheshi}"
ENV_FILE="$ROOT/env/production.env"
COMPOSE="$ROOT/compose/docker-compose.prod.yml"
BACKUP_DIR="$ROOT/state/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$BACKUP_DIR/sheshi-$STAMP.dump"

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

RESTIC_REPOSITORY="$(read_env_value RESTIC_REPOSITORY)"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must be set in $ENV_FILE}"

umask 077
mkdir -p "$BACKUP_DIR"
trap 'rm -f "$DUMP"' EXIT

docker compose --env-file "$ENV_FILE" -f "$COMPOSE" exec -T db \
  pg_dump -U sheshi -d sheshi --format=custom \
  > "$DUMP"

RESTIC_PASSWORD_FILE="$ROOT/secrets/backup_encryption_key" \
AWS_ACCESS_KEY_ID="$(cat "$ROOT/secrets/object_storage_access_key")" \
AWS_SECRET_ACCESS_KEY="$(cat "$ROOT/secrets/object_storage_secret_key")" \
restic -r "$RESTIC_REPOSITORY" backup "$DUMP"

RESTIC_PASSWORD_FILE="$ROOT/secrets/backup_encryption_key" \
AWS_ACCESS_KEY_ID="$(cat "$ROOT/secrets/object_storage_access_key")" \
AWS_SECRET_ACCESS_KEY="$(cat "$ROOT/secrets/object_storage_secret_key")" \
restic -r "$RESTIC_REPOSITORY" forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

date -Is > "$ROOT/state/last-backup-at"
