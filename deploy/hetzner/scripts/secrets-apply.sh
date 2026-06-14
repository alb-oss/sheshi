#!/usr/bin/env bash
set -euo pipefail

SOPS_FILE="${1:-${SHESHI_SOPS_FILE:-/opt/sheshi/sealed/production.sops.yaml}}"
ROOT="${SHESHI_ROOT:-/opt/sheshi}"
OUT_DIR="$ROOT/secrets"
GROUP="${SHESHI_GROUP:-sheshi}"

if [ ! -f "$SOPS_FILE" ]; then
  echo "SOPS file not found: $SOPS_FILE" >&2
  exit 1
fi

if ! command -v sops >/dev/null 2>&1; then
  echo "sops is required" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
umask 077

sops --decrypt --output-type json "$SOPS_FILE" > "$tmp"

python3 - "$tmp" "$OUT_DIR" <<'PY'
import json
import os
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1])
out_dir = pathlib.Path(sys.argv[2])
data = json.loads(source.read_text())
secrets = data.get("secrets")
if not isinstance(secrets, dict):
    raise SystemExit("SOPS file must contain a top-level 'secrets' mapping")

required = [
    "db_password",
    "db_connection_string",
    "jwt_signing_key",
    "smtp_password",
    "object_storage_access_key",
    "object_storage_secret_key",
    "backup_encryption_key",
]
placeholder = re.compile(r"(CHANGE_ME|REPLACE_ME|PLACEHOLDER|TEST-SECRET)", re.IGNORECASE)

for name in required:
    value = secrets.get(name)
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"Missing required secret value: {name}")
    if placeholder.search(value):
        raise SystemExit(f"Secret still contains a placeholder: {name}")

out_dir.mkdir(parents=True, exist_ok=True)
for name in required:
    path = out_dir / name
    path.write_text(secrets[name].rstrip("\r\n") + "\n")
    os.chmod(path, 0o640)
PY

if getent group "$GROUP" >/dev/null 2>&1; then
  chown root:"$GROUP" "$OUT_DIR" "$OUT_DIR"/*
fi
chmod 750 "$OUT_DIR"
chmod 640 "$OUT_DIR"/*

echo "Installed production secrets into $OUT_DIR"
