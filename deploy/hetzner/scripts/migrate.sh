#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?usage: migrate.sh IMAGE_TAG}"
ROOT="${SHESHI_ROOT:-/opt/sheshi}"
COMPOSE="$ROOT/compose/docker-compose.prod.yml"
ENV_FILE="$ROOT/env/production.env"

SHESHI_IMAGE_TAG="$TAG" docker compose --env-file "$ENV_FILE" -f "$COMPOSE" run --rm \
  -e Database__AutoMigrate=true \
  api --migrate-only

echo "Migration step completed for $TAG"
