#!/usr/bin/env bash
set -euo pipefail

ROOT="${SHESHI_ROOT:-/opt/sheshi}"
COMPOSE="$ROOT/compose/docker-compose.prod.yml"
ENV_FILE="$ROOT/env/production.env"
STATE="$ROOT/state"
API_HEALTH_URL="${SHESHI_API_HEALTH_URL:-https://api.sheshi.live/health/ready}"
WEB_HEALTH_URL="${SHESHI_WEB_HEALTH_URL:-https://sheshi.live}"

if [ ! -f "$STATE/previous-image-tag" ]; then
  echo "No previous image tag recorded; cannot rollback" >&2
  exit 1
fi

PREVIOUS_TAG="$(cat "$STATE/previous-image-tag")"
if [ -z "$PREVIOUS_TAG" ]; then
  echo "No previous image tag recorded; cannot rollback" >&2
  exit 1
fi

sed -i.bak "s/^SHESHI_IMAGE_TAG=.*/SHESHI_IMAGE_TAG=$PREVIOUS_TAG/" "$ENV_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE" up -d web api caddy

for _ in $(seq 1 20); do
  if curl -fsS "$API_HEALTH_URL" >/dev/null && curl -fsS "$WEB_HEALTH_URL" >/dev/null; then
    echo "Rollback to $PREVIOUS_TAG succeeded"
    exit 0
  fi
  sleep 5
done

echo "Rollback to $PREVIOUS_TAG failed health checks" >&2
exit 1
