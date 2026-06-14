# Hetzner Production Runbook

Production runs on one Hetzner Ubuntu LTS VM using Docker Compose and Caddy.
Uploaded images/videos and encrypted database backups live in Hetzner Object Storage.

## Required Host Paths

- `/opt/sheshi/compose/docker-compose.prod.yml`
- `/opt/sheshi/compose/Caddyfile`
- `/opt/sheshi/env/production.env`
- `/opt/sheshi/secrets/*`
- `/opt/sheshi/sealed/production.sops.yaml`
- `/opt/sheshi/scripts/*.sh`
- `/opt/sheshi/state/`

## First Server Bootstrap

1. Create an Ubuntu LTS VM in Hetzner.
2. Point Cloudflare DNS records `sheshi.al` and `api.sheshi.al` at the VM.
3. Point `uploads.sheshi.al` at the public Hetzner Object Storage bucket endpoint.
4. Generate one admin SSH key and one GitHub deploy SSH key.
5. Run `deploy/hetzner/scripts/bootstrap-server.sh` as root from a checked-out copy of the repo.
6. Review `/opt/sheshi/env/production.env` and replace domain/provider placeholders.
7. Copy `deploy/hetzner/secrets/production.sops.yaml` to `/opt/sheshi/sealed/production.sops.yaml`.
8. Install the age private key at `/etc/sops/age/keys.txt` with mode `0600`.
9. Run `/opt/sheshi/scripts/secrets-apply.sh /opt/sheshi/sealed/production.sops.yaml`.
10. Run `/opt/sheshi/scripts/preflight.sh COMMIT_SHA`.
11. Add GitHub environment secrets for production deploys: `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_PRIVATE_KEY`, `PROD_SSH_KNOWN_HOSTS`, and optionally `PROD_SSH_PORT`.
12. Run `/opt/sheshi/scripts/deploy.sh COMMIT_SHA`.

Bootstrap command shape:

```bash
sudo SHESHI_ADMIN_PUBLIC_KEY_FILE=/root/admin.pub \
  SHESHI_DEPLOY_PUBLIC_KEY_FILE=/root/github-deploy.pub \
  deploy/hetzner/scripts/bootstrap-server.sh
```

The bootstrap script:

- installs Docker Engine, Compose, Caddy runtime dependencies, restic, SOPS, age, fail2ban, UFW, and unattended upgrades;
- creates `sheshi-admin` for human emergency administration;
- creates `sheshi-deploy` for GitHub Actions;
- restricts the deploy key to `/opt/sheshi/scripts/deploy.sh <40-char-sha>` through a forced SSH command;
- disables root/password SSH login;
- allows only SSH, HTTP, and HTTPS through UFW;
- copies Compose, Caddy, and scripts into `/opt/sheshi`.

## SOPS Sealed Secrets

The repository is configured for SOPS + age in `.sops.yaml`. The public age recipient is safe to commit; the private key is not.

Create the encrypted production file locally:

```bash
deploy/hetzner/scripts/secrets-template.sh
sops edit deploy/hetzner/secrets/production.sops.yaml
```

Before merge, every `CHANGE_ME` value must be replaced. The apply script refuses to install empty or placeholder values.

Install on the VM:

```bash
sudo install -d -m 0700 /etc/sops/age
sudo install -m 0600 sheshi-production-age-key.txt /etc/sops/age/keys.txt
sudo SOPS_AGE_KEY_FILE=/etc/sops/age/keys.txt \
  /opt/sheshi/scripts/secrets-apply.sh /opt/sheshi/sealed/production.sops.yaml
```

Required sealed values:

- `db_password`
- `db_connection_string`
- `jwt_signing_key`
- `smtp_password`
- `object_storage_access_key`
- `object_storage_secret_key`
- `backup_encryption_key`

## Preflight

Run before the first deploy and before marking the PR ready:

```bash
/opt/sheshi/scripts/preflight.sh COMMIT_SHA
```

Preflight verifies required files, non-placeholder secrets, non-placeholder production config, free disk space, Docker Compose rendering, and Caddyfile syntax.

## Daily Operations

- Check external uptime for `https://sheshi.al` and `https://api.sheshi.al/health/ready`.
- Check `/opt/sheshi/state/last-backup-at`.
- Check disk usage with `df -h` and Docker usage with `docker system df`.
- Review failed GitHub Actions deploys and `/opt/sheshi/state/last-deploy.json`.

## Manual Deploy

```bash
/opt/sheshi/scripts/deploy.sh COMMIT_SHA
```

The image tag must be the Git commit SHA published to GHCR. Deploy runs preflight before it changes `SHESHI_IMAGE_TAG`, pulls the new web/API images by SHA, runs migrations using the new API image, starts services, and rolls back if health checks fail.

## Rollback

```bash
/opt/sheshi/scripts/rollback.sh
```

Rollback returns web/API containers to the previous image tag. Database migrations
are not automatically rolled back, so use this only for app-image failures that
are compatible with the current schema.

## Host File Layout

```text
/opt/sheshi/
  compose/
  env/
  scripts/
  sealed/
  secrets/
  state/
```
