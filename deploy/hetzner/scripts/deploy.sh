#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?usage: deploy.sh IMAGE_TAG}"
ROOT="${SHESHI_ROOT:-/opt/sheshi}"
COMPOSE="$ROOT/compose/docker-compose.prod.yml"
ENV_FILE="$ROOT/env/production.env"
STATE="$ROOT/state"
LOCK="$STATE/deploy.lock"
API_HEALTH_URL="${SHESHI_API_HEALTH_URL:-https://api.sheshi.al/health/ready}"
WEB_HEALTH_URL="${SHESHI_WEB_HEALTH_URL:-https://sheshi.al}"

mkdir -p "$STATE"

set_image_tag() {
  local tag="$1"

  if grep -q '^SHESHI_IMAGE_TAG=' "$ENV_FILE"; then
    sed -i.bak "s/^SHESHI_IMAGE_TAG=.*/SHESHI_IMAGE_TAG=$tag/" "$ENV_FILE"
  else
    printf '\nSHESHI_IMAGE_TAG=%s\n' "$tag" >> "$ENV_FILE"
  fi
}

(
  flock -n 9

  PREVIOUS_TAG="$(sed -n 's/^SHESHI_IMAGE_TAG=//p' "$ENV_FILE" | tail -n 1 || true)"
  printf '%s\n' "$PREVIOUS_TAG" > "$STATE/previous-image-tag"

  set_image_tag "$TAG"

  docker compose --env-file "$ENV_FILE" -f "$COMPOSE" pull web api
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE" up -d db
  "$ROOT/scripts/migrate.sh" "$TAG"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE" up -d web api caddy

  for _ in $(seq 1 30); do
    if curl -fsS "$API_HEALTH_URL" >/dev/null && curl -fsS "$WEB_HEALTH_URL" >/dev/null; then
      printf '%s\n' "$TAG" > "$STATE/last-good-image-tag"
      printf '{"tag":"%s","deployed_at":"%s"}\n' "$TAG" "$(date -Is)" > "$STATE/last-deploy.json"
      exit 0
    fi
    sleep 5
  done

  "$ROOT/scripts/rollback.sh"
  exit 1
) 9>"$LOCK"
