#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?usage: deploy.sh IMAGE_TAG}"
ROOT="${SHESHI_ROOT:-/opt/sheshi}"
COMPOSE="$ROOT/compose/docker-compose.prod.yml"
ENV_FILE="$ROOT/env/production.env"
STATE="$ROOT/state"
LOCK="$STATE/deploy.lock"
API_HEALTH_URL="${SHESHI_API_HEALTH_URL:-https://api.sheshi.live/health/ready}"
WEB_HEALTH_URL="${SHESHI_WEB_HEALTH_URL:-https://sheshi.live}"

mkdir -p "$STATE"

registry_login_from_stdin() {
  if [ -t 0 ]; then
    return
  fi

  local username token docker_config
  if ! IFS= read -r -t 2 username; then
    return
  fi
  if ! IFS= read -r -t 2 token; then
    return
  fi
  if [ -z "$username" ] || [ -z "$token" ]; then
    return
  fi

  docker_config="$(mktemp -d)"
  chmod 700 "$docker_config"
  export DOCKER_CONFIG="$docker_config"
  trap 'docker logout ghcr.io >/dev/null 2>&1 || true; rm -rf "$DOCKER_CONFIG"' EXIT
  printf '%s\n' "$token" | docker login ghcr.io -u "$username" --password-stdin >/dev/null
}

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

  "$ROOT/scripts/preflight.sh" "$TAG"
  registry_login_from_stdin

  SHESHI_IMAGE_TAG="$TAG" docker compose --env-file "$ENV_FILE" -f "$COMPOSE" pull web api
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE" up -d db
  "$ROOT/scripts/migrate.sh" "$TAG"
  set_image_tag "$TAG"
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
