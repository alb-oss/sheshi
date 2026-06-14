# Hetzner Production Runbook

Production runs on one Hetzner Ubuntu LTS VM using Docker Compose and Caddy.
Uploaded images and encrypted database backups live in Hetzner Object Storage.

## Required Host Paths

- `/opt/sheshi/compose/docker-compose.prod.yml`
- `/opt/sheshi/compose/Caddyfile`
- `/opt/sheshi/env/production.env`
- `/opt/sheshi/secrets/*`
- `/opt/sheshi/scripts/*.sh`
- `/opt/sheshi/state/`

## First Server Bootstrap

1. Create an Ubuntu LTS VM in Hetzner.
2. Point Cloudflare DNS records `sheshi.al` and `api.sheshi.al` at the VM.
3. Point `uploads.sheshi.al` at the public Hetzner Object Storage bucket endpoint.
4. Install Docker Engine, the Docker Compose plugin, `restic`, and `curl`.
5. Create a deploy user with Docker access and no password SSH login.
6. Copy Compose and Caddy files to `/opt/sheshi/compose`.
7. Copy scripts to `/opt/sheshi/scripts` and keep them executable.
8. Create `/opt/sheshi/env/production.env` from `deploy/hetzner/production.env.example`.
9. Create runtime secret files under `/opt/sheshi/secrets` with mode `0600`.
10. Add GitHub environment secrets for production deploys: `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_PRIVATE_KEY`, `PROD_SSH_KNOWN_HOSTS`, and optionally `PROD_SSH_PORT`.
11. Run `/opt/sheshi/scripts/deploy.sh COMMIT_SHA`.

## Daily Operations

- Check external uptime for `https://sheshi.al` and `https://api.sheshi.al/health/ready`.
- Check `/opt/sheshi/state/last-backup-at`.
- Check disk usage with `df -h` and Docker usage with `docker system df`.
- Review failed GitHub Actions deploys and `/opt/sheshi/state/last-deploy.json`.

## Manual Deploy

```bash
/opt/sheshi/scripts/deploy.sh COMMIT_SHA
```

The image tag should be the Git commit SHA published to GHCR.

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
  secrets/
  state/
```
