#!/usr/bin/env bash
set -euo pipefail

command="${SSH_ORIGINAL_COMMAND:-}"

if [[ "$command" =~ ^/opt/sheshi/scripts/deploy\.sh[[:space:]]+[\"\']?([0-9a-f]{40})[\"\']?[[:space:]]*$ ]]; then
  exec /opt/sheshi/scripts/deploy.sh "${BASH_REMATCH[1]}"
fi

echo "Rejected SSH command: $command" >&2
exit 126
