#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="${1:-$ROOT/deploy/hetzner/secrets/production.sops.yaml}"

if [ -e "$OUT" ]; then
  echo "$OUT already exists; refusing to overwrite" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required" >&2
  exit 1
fi

if ! command -v sops >/dev/null 2>&1; then
  echo "sops is required" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
umask 077

db_password="$(openssl rand -base64 36 | tr -d '\n')"
jwt_signing_key="$(openssl rand -base64 64 | tr -d '\n')"
backup_encryption_key="$(openssl rand -base64 48 | tr -d '\n')"

cat > "$OUT" <<YAML
metadata_unencrypted:
  environment: production
  description: Encrypted production secrets for Sheshi. Values are decrypted only on the VM.

secrets:
  db_password: "$db_password"
  db_connection_string: "Host=db;Port=5432;Database=sheshi;Username=sheshi;Password=$db_password"
  jwt_signing_key: "$jwt_signing_key"
  smtp_password: "CHANGE_ME_SMTP_PASSWORD"
  object_storage_access_key: "CHANGE_ME_R2_UPLOADS_ACCESS_KEY"
  object_storage_secret_key: "CHANGE_ME_R2_UPLOADS_SECRET_KEY"
  backup_storage_access_key: "CHANGE_ME_R2_BACKUPS_ACCESS_KEY"
  backup_storage_secret_key: "CHANGE_ME_R2_BACKUPS_SECRET_KEY"
  backup_encryption_key: "$backup_encryption_key"
YAML

sops --encrypt --in-place "$OUT"

cat <<EOF
Created encrypted template:
  $OUT

Next:
  sops edit $OUT

Replace every CHANGE_ME value before applying secrets or merging to main.
EOF
