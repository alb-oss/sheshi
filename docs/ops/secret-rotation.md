# Secret Rotation Runbook

## Immediate Rotation Triggers

- A secret appears in git history.
- A secret appears in GitHub Actions logs.
- A maintainer device is lost.
- A maintainer leaves the project.
- A provider reports compromise or suspicious access.

## Runtime Secret Location

Runtime secrets live under `/opt/sheshi/secrets` on the production VM. Files must
be readable only by the deploy/runtime user.

Required files:

- `db_password`
- `db_connection_string`
- `jwt_signing_key`
- `smtp_password`
- `object_storage_access_key`
- `object_storage_secret_key`
- `backup_encryption_key`

## GitHub Environment Secrets

The `production` environment stores deploy-only SSH secrets:

- `PROD_SSH_HOST`
- `PROD_SSH_USER`
- `PROD_SSH_PRIVATE_KEY`
- `PROD_SSH_KNOWN_HOSTS`
- `PROD_SSH_PORT` when the VM does not use port `22`

Do not store application runtime secrets in GitHub Actions unless they are only
needed by CI. Runtime secrets should stay on the VM and in the recovery copy.

## SOPS Recovery Copy

Keep the recovery copy in `deploy/hetzner/secrets/production.sops.yaml` or a private ops repository using the same `.sops.yaml` age recipient. The encrypted file may be committed; the age private key must never be committed.

The age private key should be stored in a team password manager and installed on the VM at:

```text
/etc/sops/age/keys.txt
```

After editing the encrypted file, apply it on the VM:

```bash
sudo SOPS_AGE_KEY_FILE=/etc/sops/age/keys.txt \
  /opt/sheshi/scripts/secrets-apply.sh /opt/sheshi/sealed/production.sops.yaml
```

## Rotation Order

1. Create the replacement secret.
2. Update `production.sops.yaml` with `sops edit` or `sops set`.
3. Copy the encrypted file to `/opt/sheshi/sealed/production.sops.yaml`.
4. Run `/opt/sheshi/scripts/secrets-apply.sh`.
5. Restart the affected service.
6. Verify health checks.
7. Revoke the old secret.
8. Record the rotation date.

## Service Restart Map

- Database password: update Postgres, `db_connection_string`, then restart `db` and `api`.
- JWT signing key: restart `api`; expect existing sessions to be invalidated.
- SMTP password: restart `api`.
- Object storage keys: restart `api`; run a backup after rotating backup credentials.
- Backup encryption key: do not overwrite the old key until old backups have been intentionally re-encrypted or retired.
- GitHub SSH deploy key: update the GitHub `production` environment secret and VM `authorized_keys`.
- SOPS age key: add the new age recipient to `.sops.yaml`, run `sops updatekeys deploy/hetzner/secrets/production.sops.yaml`, install the new private key on the VM, then remove the old recipient after a verified decrypt/apply.
