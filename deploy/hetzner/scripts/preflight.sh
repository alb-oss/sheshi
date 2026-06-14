#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"
ROOT="${SHESHI_ROOT:-/opt/sheshi}"
COMPOSE="$ROOT/compose/docker-compose.prod.yml"
CADDYFILE="$ROOT/compose/Caddyfile"
ENV_FILE="$ROOT/env/production.env"
SECRETS_DIR="$ROOT/secrets"
MIN_FREE_MB="${SHESHI_MIN_FREE_MB:-2048}"

fail() {
  echo "preflight: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

require_file() {
  [ -f "$1" ] || fail "missing file: $1"
}

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

check_not_placeholder() {
  local label="$1"
  local value="$2"
  [ -n "$value" ] || fail "$label is empty"
  if printf '%s' "$value" | grep -Eiq 'CHANGE_ME|REPLACE_ME|PLACEHOLDER|TEST-SECRET|YOUR-|YOUR_|EXAMPLE\.|0000000000000000000000000000000000000000'; then
    fail "$label still contains a placeholder"
  fi
}

require_command docker
require_command curl
require_command flock

require_file "$COMPOSE"
require_file "$CADDYFILE"
require_file "$ENV_FILE"

for name in \
  db_password \
  db_connection_string \
  jwt_signing_key \
  smtp_password \
  object_storage_access_key \
  object_storage_secret_key \
  backup_storage_access_key \
  backup_storage_secret_key \
  backup_encryption_key; do
  path="$SECRETS_DIR/$name"
  require_file "$path"
  [ -s "$path" ] || fail "secret file is empty: $path"
  if grep -Eiq 'CHANGE_ME|REPLACE_ME|PLACEHOLDER|TEST-SECRET' "$path"; then
    fail "secret file still contains a placeholder: $path"
  fi
done

for key in \
  VITE_API_BASE_URL \
  Jwt__Issuer \
  Jwt__Audience \
  Frontend__BaseUrl \
  Cors__AllowedOrigins \
  AllowedHosts \
  Storage__Provider \
  Storage__PublicBaseUrl \
  Storage__S3__Bucket \
  Storage__S3__Endpoint \
  Storage__S3__Region \
  RESTIC_REPOSITORY; do
  check_not_placeholder "$key" "$(read_env_value "$key")"
done

[ "$(read_env_value Storage__Provider)" = "s3" ] || fail "Storage__Provider must be s3 in production"

effective_tag="$TAG"
if [ -z "$effective_tag" ]; then
  effective_tag="$(read_env_value SHESHI_IMAGE_TAG)"
fi
check_not_placeholder "SHESHI_IMAGE_TAG" "$effective_tag"

free_mb="$(df -Pm "$ROOT" | awk 'NR == 2 { print $4 }')"
case "$free_mb" in
  ''|*[!0-9]*) fail "could not determine free disk space for $ROOT" ;;
esac
[ "$free_mb" -ge "$MIN_FREE_MB" ] || fail "only ${free_mb}MB free under $ROOT; need at least ${MIN_FREE_MB}MB"

SHESHI_IMAGE_TAG="$effective_tag" docker compose --env-file "$ENV_FILE" -f "$COMPOSE" config >/dev/null

docker run --rm \
  -v "$CADDYFILE:/etc/caddy/Caddyfile:ro" \
  caddy:2.10-alpine \
  caddy validate --config /etc/caddy/Caddyfile >/dev/null

echo "preflight: ok"
