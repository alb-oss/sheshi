#!/usr/bin/env bash
set -euo pipefail

ROOT="${SHESHI_ROOT:-/opt/sheshi}"
ENV_FILE="$ROOT/env/production.env"
DRILL_DIR="$ROOT/state/restore-drill"
DB_CONTAINER="sheshi-restore-drill-db"

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

RESTIC_REPOSITORY="$(read_env_value RESTIC_REPOSITORY)"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must be set in $ENV_FILE}"

cleanup() {
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$DRILL_DIR"
}
trap cleanup EXIT

rm -rf "$DRILL_DIR"
mkdir -p "$DRILL_DIR"

RESTIC_PASSWORD_FILE="$ROOT/secrets/backup_encryption_key" \
AWS_ACCESS_KEY_ID="$(cat "$ROOT/secrets/backup_storage_access_key")" \
AWS_SECRET_ACCESS_KEY="$(cat "$ROOT/secrets/backup_storage_secret_key")" \
restic -r "$RESTIC_REPOSITORY" restore latest --target "$DRILL_DIR"

LATEST_DUMP="$(find "$DRILL_DIR" -name 'sheshi-*.dump' | sort | tail -n 1)"
test -n "$LATEST_DUMP"

docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
docker run --rm --name "$DB_CONTAINER" \
  -e POSTGRES_USER=sheshi \
  -e POSTGRES_PASSWORD=sheshi \
  -e POSTGRES_DB=sheshi \
  -d postgres:17 >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$DB_CONTAINER" pg_isready -U sheshi -d sheshi >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$DB_CONTAINER" pg_isready -U sheshi -d sheshi >/dev/null
docker exec -i "$DB_CONTAINER" pg_restore -U sheshi -d sheshi --clean --if-exists < "$LATEST_DUMP"
docker exec "$DB_CONTAINER" psql -U sheshi -d sheshi -c 'select count(*) from "Rooms";'
date -Is > "$ROOT/state/last-restore-drill-at"
