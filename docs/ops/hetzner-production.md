# Hetzner Production Runbook

Production runs on one Hetzner Debian 13 or Ubuntu LTS VM using Docker Compose and Caddy.
Uploaded images/videos and encrypted database backups live in Cloudflare R2.

## Required Host Paths

- `/opt/sheshi/compose/docker-compose.prod.yml`
- `/opt/sheshi/compose/Caddyfile`
- `/opt/sheshi/env/production.env`
- `/opt/sheshi/secrets/*`
- `/opt/sheshi/sealed/production.sops.yaml`
- `/opt/sheshi/scripts/*.sh`
- `/opt/sheshi/state/`

## First Server Bootstrap

1. Create a Debian 13 or Ubuntu LTS VM in Hetzner.
2. Point Cloudflare DNS records `sheshi.live` and `api.sheshi.live` at the VM.
3. Create Cloudflare R2 buckets named `sheshi-live-uploads` and `sheshi-live-backups`.
4. Add the R2 custom domain `uploads.sheshi.live` to the `sheshi-live-uploads` bucket.
5. Generate one admin SSH key and one GitHub deploy SSH key.
6. Run `deploy/hetzner/scripts/bootstrap-server.sh` as root from a checked-out copy of the repo.
7. Review `/opt/sheshi/env/production.env` and replace domain/provider placeholders.
8. Copy `deploy/hetzner/secrets/production.sops.yaml` to `/opt/sheshi/sealed/production.sops.yaml`.
9. Install the age private key at `/etc/sops/age/keys.txt` with mode `0600`.
10. Run `/opt/sheshi/scripts/secrets-apply.sh /opt/sheshi/sealed/production.sops.yaml`.
11. Run `/opt/sheshi/scripts/preflight.sh COMMIT_SHA`.
12. Add GitHub environment secrets for production deploys: `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_PRIVATE_KEY`, `PROD_SSH_KNOWN_HOSTS`, and optionally `PROD_SSH_PORT`.
13. Run `/opt/sheshi/scripts/deploy.sh COMMIT_SHA`.

Bootstrap command shape:

```bash
sudo SHESHI_ADMIN_PUBLIC_KEY_FILE=/root/admin.pub \
  SHESHI_DEPLOY_PUBLIC_KEY_FILE=/root/github-deploy.pub \
  deploy/hetzner/scripts/bootstrap-server.sh
```

The bootstrap script:

- detects Debian vs Ubuntu and configures Docker's matching official apt repository;
- installs Docker Engine, Compose, restic, SOPS, age, fail2ban, UFW, and unattended upgrades;
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
- `backup_storage_access_key`
- `backup_storage_secret_key`
- `backup_encryption_key`

Use separate bucket-scoped R2 API tokens:

- Uploads token: Object Read & Write for `sheshi-live-uploads`.
- Backups token: Object Read & Write for `sheshi-live-backups`.

Do not reuse the uploads token for backups. The API container only receives the uploads token; backup scripts only read the backups token.

## Preflight

Run before the first deploy and before marking the PR ready:

```bash
/opt/sheshi/scripts/preflight.sh COMMIT_SHA
```

Preflight verifies required files, non-placeholder secrets, non-placeholder production config, free disk space, Docker Compose rendering, and Caddyfile syntax.

## Automated Deploys

Merging to `main` runs CI, publishes SHA-tagged web/API images to GHCR, then runs the production deploy workflow. The deploy job passes its short-lived `GITHUB_TOKEN` to the VM over SSH stdin so `/opt/sheshi/scripts/deploy.sh` can pull private-or-public GHCR images with a temporary Docker config. The script logs out and removes that Docker config before exiting, so no long-lived GHCR pull token is stored on the VM.

## Daily Operations

- Check external uptime for `https://sheshi.live` and `https://api.sheshi.live/health/ready`.
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
