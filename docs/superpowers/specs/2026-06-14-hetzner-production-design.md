# Sheshi Hetzner Production Design

Date: 2026-06-14
Status: draft for review
Scope: production deployment architecture, operational model, secrets, CI/CD, backups, and deployment readiness for Sheshi on Hetzner.

## Executive Summary

Sheshi should run as a single-node production deployment on one Hetzner Cloud VM for v1. The design deliberately keeps compute simple while moving durable data outside the disposable parts of the system.

The target shape is:

- Cloudflare in front for DNS, edge TLS, WAF controls, bot controls, and CDN behavior.
- One Hetzner VM running Docker Compose.
- Caddy as the public reverse proxy and TLS terminator on the VM.
- Separate containers for the TanStack web app, the .NET API, Postgres 17, backup jobs, and optional Redis.
- Hetzner Object Storage for uploaded images and encrypted database backups.
- GitHub Actions auto-deploying `main` to production after CI passes.
- GHCR immutable images tagged by commit SHA.
- Runtime secrets stored on the VM as file secrets, with SOPS + age sealed secrets as the encrypted recovery/declarative copy.

The goal is not "toy self-hosting." The goal is a boring, reproducible, observable single-VM production system that can be rebuilt from source and backups.

## Confirmed Product Decisions

- Use a single Hetzner VM for production v1.
- Use Docker Compose, Caddy, and plain scripts rather than Coolify, Dokploy, Kubernetes, or Nomad.
- Use full automatic deploys from `main` after CI passes.
- Use Cloudflare in front of Hetzner.
- Use Hetzner Object Storage for uploaded images and encrypted database backups.
- Keep production email with an external transactional provider. Do not self-host SMTP.
- Store GitHub deploy secrets separately from runtime app secrets.
- Keep runtime production secrets on the VM, mounted into containers as Docker Compose secrets, and manage the recovery copy with SOPS + age.

## Goals

- A fresh VM can be provisioned and prepared from documented commands.
- A merge to protected `main` automatically builds, publishes, deploys, health-checks, and either completes or rolls back.
- Production does not depend on untracked local edits or manual server builds.
- Runtime secrets are not committed, not shipped through every deploy, and not broadly exposed through environment variables.
- Uploaded media survives app rebuilds, container replacement, VM reprovisioning, and deploy rollback.
- Database backups are encrypted, copied off the VM, retained, monitored, and periodically restored.
- The app is compatible with Cloudflare and Caddy proxying, including OAuth callbacks and SignalR WebSockets.
- The system is operable by a small OSS team without paid platform lock-in.

## Non-Goals For V1

- Multi-node high availability.
- Kubernetes.
- Self-hosted email deliverability.
- A full secrets manager such as Vault, Infisical, or 1Password Connect.
- Automatic Hetzner infrastructure provisioning in the first implementation if it slows down the production path.
- Zero-downtime schema migrations. Deploys should be short and reliable; advanced migration choreography can come later.
- Running decrypted production secrets through GitHub Actions on every deployment.

## Current Repository Findings

These findings shape the production-readiness work:

- `package.json`, `Makefile`, and the root `README.md` still reference a missing legacy app path. The real web app is at the repo root.
- `.env` is currently tracked. Production and local secret files should not be tracked.
- The actual web app is a TanStack Start/React app under `src`.
- The API is ASP.NET Core targeting .NET 10 under `server/Sheshi.Api`.
- Local `docker-compose.yml` only starts Postgres and Mailpit for development.
- The API already has `/health`, migrations, Identity auth, JWT auth, OAuth providers, SMTP email support, SignalR, moderation, and image upload validation.
- Media storage now keeps validation in `IImageStorage`/`IVideoStorage` and switches the durable sink through `IBlobStore`.
- S3-compatible object storage can be selected through configuration without changing message-controller behavior deeply.
- SignalR presence is process-local through `PresenceTracker`. That is acceptable for one app instance.
- Current rate limiting is process-local. That is acceptable for one app instance, with Cloudflare providing edge-level protection.
- OAuth callback URL generation uses `Request.Scheme`, so forwarded headers must be configured before production proxying.
- Production migrations are opt-in through `Database:AutoMigrate`; production deploys should run migrations explicitly instead.

## Target Topology

```text
Internet
  |
  v
Cloudflare
  - DNS
  - proxied records
  - WAF/bot rules
  - DDoS edge protection
  - CDN for cacheable public assets
  |
  v
Hetzner Cloud VM
  - Ubuntu LTS
  - Docker Engine + Compose plugin
  - Caddy
  - sheshi-web container
  - sheshi-api container
  - sheshi-postgres container
  - sheshi-backup container/job
  - optional sheshi-redis container
  |
  v
Hetzner Object Storage
  - uploaded images
  - encrypted Postgres backups
  - restore drill artifacts
```

## Domains

The expected production domains should be explicit:

- `sheshi.al` or chosen root domain: public web app.
- `api.sheshi.al`: API and SignalR hub.
- `uploads.sheshi.al` or object-storage public/custom domain: uploaded images.
- Optional `status.sheshi.al`: uptime/status page later.

The web app must use `VITE_API_BASE_URL=https://api.sheshi.al`.

The mobile app must use the same production API base through Expo configuration.

The API must set:

- `Frontend:BaseUrl=https://sheshi.al`
- `Cors:AllowedOrigins=https://sheshi.al`
- JWT issuer and audience matching production.
- OAuth provider callback URLs matching `https://api.sheshi.al/api/auth/external/callback`.

## Hetzner VM

Recommended v1 size:

- Start with a Hetzner shared vCPU instance with at least 4 GB RAM.
- Prefer 80 GB or more local disk if Postgres and logs live on the VM.
- Use an EU location, likely Falkenstein or Helsinki.
- Attach Hetzner backups or snapshots if budget allows, but do not treat them as the only backup.

Base packages:

- Docker Engine.
- Docker Compose plugin.
- Caddy, either host-installed or containerized.
- `restic` or `pgBackRest` tooling for backups.
- `jq`, `curl`, `flock`, `openssl`, `age`, and basic admin tools.
- Firewall tooling if not fully managed through Hetzner firewall.

Host layout:

```text
/opt/sheshi/
  compose/
    docker-compose.prod.yml
    Caddyfile
  env/
    production.env
  secrets/
    db_password
    jwt_signing_key
    smtp_password
    object_storage_access_key
    object_storage_secret_key
    backup_encryption_key
    ghcr_read_token
    google_client_secret
    microsoft_client_secret
    apple_private_key
  releases/
    current
    previous
  scripts/
    deploy.sh
    rollback.sh
    migrate.sh
    backup-now.sh
    restore-drill.sh
  state/
    deploy.lock
    last-good.env
    last-deploy.json
```

## Containers

### `caddy`

Responsibilities:

- Accept public HTTP/HTTPS traffic.
- Proxy web traffic to `sheshi-web`.
- Proxy API traffic to `sheshi-api`.
- Support WebSocket upgrades for `/hub`.
- Set security headers where appropriate.
- Emit access/error logs with rotation.

Recommended route shape:

```text
https://sheshi.al -> sheshi-web:3000
https://api.sheshi.al -> sheshi-api:8080
https://api.sheshi.al/hub -> sheshi-api:8080/hub with WebSocket support
```

Cloudflare may terminate TLS at the edge, but Caddy should still serve HTTPS from Cloudflare to origin where practical. Use Cloudflare Full (strict) once origin certificates are configured correctly.

### `sheshi-web`

Responsibilities:

- Serve TanStack Start SSR output for the public web app.
- Read non-secret production config from environment.
- Connect to the API through public API base URL.

Production readiness tasks:

- Fix root scripts to build the real app.
- Confirm TanStack/Nitro output can run as a Node SSR container on Hetzner.
- Add a web Dockerfile.
- Ensure generated assets are immutable/cacheable.
- Ensure SSR error wrapper remains active.

### `sheshi-api`

Responsibilities:

- Serve REST API.
- Serve SignalR hub.
- Run moderation and messaging logic.
- Store and retrieve Postgres data.
- Store images through S3-compatible image storage.
- Send transactional email through external SMTP.

Production readiness tasks:

- Add API Dockerfile for .NET 10.
- Add `global.json` pinning .NET 10 SDK.
- Add forwarded headers before HTTPS redirection.
- Add S3-compatible `IImageStorage` implementation.
- Add production readiness endpoints.
- Add support for high-risk secret values from files.
- Ensure startup does not auto-migrate in production.

### `postgres`

Responsibilities:

- Store application data.
- Persist to a Docker named volume or a clearly mounted host directory.
- Accept connections only from the Docker network, not the public internet.

Production defaults:

- Postgres 17 image.
- Dedicated database/user for Sheshi.
- Password loaded from Docker secret.
- Local volume with clear backup process.
- Healthcheck enabled.
- Tuned conservatively for a single-VM app.

### `backup`

Responsibilities:

- Create scheduled encrypted backups.
- Upload backups to Hetzner Object Storage.
- Verify backup freshness.
- Support manual restore drills.

Implementation may be a container, host systemd timer, or cron job. Prefer a versioned script in `deploy/hetzner/scripts` so the backup behavior is reviewable.

### `redis`

Redis is optional in v1.

Do not add it just because production systems often have Redis. Add it only if one of these becomes true:

- SignalR backplane is needed.
- Distributed rate limiting becomes needed.
- Background jobs or queues need Redis.
- Session-like ephemeral coordination becomes necessary.

For a single app instance, process-local SignalR presence and rate limiting are acceptable with Cloudflare in front.

## Object Storage

Hetzner Object Storage should hold:

- Uploaded images and videos.
- Encrypted database backups.
- Optional restore drill outputs.

It should not hold:

- Plaintext database dumps.
- Unencrypted production secrets.
- Raw user uploads before image validation.

Media upload flow:

```text
Browser/mobile
  -> API receives multipart image/video
  -> API validates content type and size
  -> API verifies image format or video signature
  -> API strips metadata and re-encodes images
  -> API uploads validated bytes to Hetzner Object Storage
  -> API stores public object URL in Postgres
```

The existing `IImageStorage` and `IVideoStorage` interfaces should remain the API boundary. Production should select the S3-compatible `IBlobStore` through configuration, while dev/test can keep the local `IBlobStore`.

Recommended config shape:

```text
Storage__Provider=s3
Storage__PublicBaseUrl=https://uploads.sheshi.al
Storage__MaxBytes=5242880
Storage__S3__Bucket=sheshi-uploads
Storage__S3__Endpoint=https://<hetzner-object-storage-endpoint>
Storage__S3__Region=<region>
Storage__S3__AccessKeyFile=/run/secrets/object_storage_access_key
Storage__S3__SecretKeyFile=/run/secrets/object_storage_secret_key
```

## Secrets Model

### Rule

GitHub stores deploy credentials only. The Hetzner VM stores runtime secrets. A separate encrypted recovery copy stores break-glass access.

### GitHub environment secrets

Store only:

- `PROD_SSH_PRIVATE_KEY`
- `PROD_SSH_HOST`
- `PROD_SSH_USER`
- `PROD_SSH_KNOWN_HOSTS`

Optional:

- `PROD_DEPLOY_PORT` if SSH does not use port 22.

Avoid storing:

- Production database password.
- JWT signing key.
- SMTP password.
- OAuth client secrets.
- Object storage secret key.
- Backup encryption key.
- Full production `.env`.

### VM runtime secrets

Runtime secrets live under:

```text
/opt/sheshi/secrets/
```

Recommended permissions:

```bash
chown -R root:sheshi /opt/sheshi/secrets /opt/sheshi/env
chmod 750 /opt/sheshi/secrets /opt/sheshi/env
chmod 640 /opt/sheshi/secrets/* /opt/sheshi/env/*
```

Compose should mount secrets per service:

```yaml
services:
  api:
    secrets:
      - db_password
      - jwt_signing_key
      - smtp_password
      - object_storage_access_key
      - object_storage_secret_key

secrets:
  db_password:
    file: /opt/sheshi/secrets/db_password
```

The API should support `*_FILE` style configuration for high-risk values. This avoids passing secrets through broad environment output. Examples:

```text
ConnectionStrings__DefaultFile=/run/secrets/db_connection_string
Jwt__SigningKeyFile=/run/secrets/jwt_signing_key
Smtp__PasswordFile=/run/secrets/smtp_password
Storage__S3__AccessKeyFile=/run/secrets/object_storage_access_key
Storage__S3__SecretKeyFile=/run/secrets/object_storage_secret_key
```

If .NET configuration remains environment-only temporarily, use a narrow entrypoint shim as a transitional measure, then replace it with native file-secret support.

### Recovery copy

The backup encryption key must not live only on the VM. If the VM dies and the key dies with it, backups are not useful.

Maintain one encrypted recovery/declarative source:

- Preferred: a team password manager such as 1Password or Bitwarden.
- Accepted for this repo: a SOPS + age encrypted `deploy/hetzner/secrets/production.sops.yaml` file. The public age recipient is committed in `.sops.yaml`; the private age key is stored off-repo and installed on the VM only for decrypt/apply.

The recovery source should contain:

- Backup encryption key.
- Database password.
- JWT signing key.
- Object storage access keys.
- SMTP password.
- OAuth client secrets.
- GHCR read token if needed.
- Emergency SSH instructions.

The server applies sealed secrets by decrypting the SOPS file into Docker Compose secret files:

```bash
SOPS_AGE_KEY_FILE=/etc/sops/age/keys.txt \
  /opt/sheshi/scripts/secrets-apply.sh /opt/sheshi/sealed/production.sops.yaml
```

### Rotation

Rotate immediately:

- Anything that has ever been committed in `.env`.
- Any secret pasted into a GitHub Actions log.
- Any SSH key used from an uncontrolled machine.

Rotation cadence:

- Deploy SSH key: rotate at least every 6 months or when a maintainer changes.
- Object storage keys: rotate at least annually or after suspected exposure.
- JWT signing key: rotate with a token invalidation plan.
- Backup encryption key: rotate cautiously; old backups remain tied to the old key unless re-encrypted.

## GitHub Actions

### Workflow Overview

Required workflows:

```text
.github/workflows/ci.yml
.github/workflows/publish-images.yml
.github/workflows/deploy-production.yml
```

The flow:

```text
pull_request
  -> CI only, no production secrets

main push
  -> CI
  -> build immutable images
  -> push images to GHCR
  -> deploy production over SSH
  -> health check
  -> rollback on failure
```

### CI

Run on PRs and `main`.

Checks:

- `npm ci`
- web lint/typecheck if configured.
- web production build.
- `.NET restore`
- `.NET build`
- `.NET test`
- Docker build for API and web.
- Secret scan if a lightweight tool is adopted.

CI must not need production secrets.

### Image Publishing

Build and publish:

- `ghcr.io/<org>/sheshi-web:<sha>`
- `ghcr.io/<org>/sheshi-api:<sha>`

Optional tags:

- `main`
- date-based tag

Deploys should use SHA tags or image digests, not mutable `latest`.

Enable:

- Build cache.
- SBOM if practical.
- Provenance/attestation where available.

### Production Deploy

Trigger:

- Automatic after successful `main` image publish.

GitHub controls:

- Use GitHub environment `production`.
- Restrict environment deployment branch to `main`.
- Use `concurrency: production`.
- Default token permissions to read-only.
- Grant elevated permissions only per job.
- Avoid `pull_request_target`.
- Pin third-party actions by commit SHA for hardened workflows.
- Do not use self-hosted runners for public PRs.

Deploy mechanism:

- GitHub Actions connects by SSH to the VM.
- Host key is pinned through `PROD_SSH_KNOWN_HOSTS`.
- Deploy user is non-root.
- Deploy user can run only the required deploy script path, or has narrowly documented Docker permissions.
- Remote deploy script receives the commit SHA and image tags.

Deploy algorithm:

```text
1. Acquire /opt/sheshi/state/deploy.lock with flock.
2. Record current running image tags as previous.
3. docker login to GHCR if needed.
4. docker compose pull api web.
5. Run database migration job/bundle.
6. Start updated api and web containers.
7. Wait for container healthchecks.
8. Check https://api.sheshi.al/health/ready.
9. Check https://sheshi.al.
10. Mark release as last good.
11. Release lock.
```

Rollback algorithm:

```text
1. If migration failed before app swap, keep previous app running.
2. If app health failed after swap, restore previous image tags.
3. docker compose up -d api web.
4. Re-run health checks.
5. Emit failure details in GitHub Actions logs.
```

Database rollback is not automatic. Migrations must be written with backward-compatible deploys when possible. For risky migrations, require a manual maintenance procedure.

## Database Migrations

Production must not rely on `Database:AutoMigrate=true` during normal API startup.

Recommended approach:

- Generate an EF Core migration bundle in CI or in the API image.
- Deploy script runs the migration bundle before swapping to the new app.
- Migration step uses the same production DB connection as the API.
- Migration logs are captured in deploy output.

Rules:

- No destructive migration without explicit backup confirmation.
- Prefer expand/contract migrations for breaking schema changes.
- Seed operations must be idempotent.
- Failed migrations stop deployment before app replacement where possible.

## Health Checks

Add:

- `/health/live`: process is alive.
- `/health/ready`: process can serve real traffic.

Readiness should check:

- Database connection.
- Pending critical migrations if detectable.
- Object storage configuration if image upload is enabled.

Keep the existing `/health` as a compatibility alias if useful.

Caddy and GitHub deploy checks should use readiness for deploy success.

## Cloudflare

Cloudflare should provide:

- DNS.
- Proxied web and API records.
- WAF managed rules where available.
- Rate limiting or bot controls for auth/write-heavy endpoints if abuse appears.
- CDN behavior for static assets and uploaded media if compatible with privacy policy.
- TLS mode Full (strict) after origin certificate setup.

Cloudflare should not hide broken origin observability. Origin logs and external uptime checks remain required.

Cloudflare records:

```text
sheshi.al      -> Hetzner VM IP, proxied
api.sheshi.al  -> Hetzner VM IP, proxied
uploads...     -> Hetzner Object Storage/custom domain or proxied route if supported
```

## Caddy

Caddy should:

- Redirect HTTP to HTTPS.
- Proxy web and API to internal containers.
- Preserve headers needed by ASP.NET Core forwarded headers.
- Support WebSocket upgrades.
- Set security headers.
- Compress safe text responses.
- Emit access and error logs.

Candidate headers:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

CSP should be added after testing OAuth, TanStack SSR, inline styles/scripts, images, and SignalR connect sources. Do not ship a pretend CSP that breaks the app or silently allows everything.

## ASP.NET Production Hardening

Required changes:

- Configure forwarded headers before `UseHttpsRedirection`.
- Trust only known proxy networks where practical.
- Ensure OAuth callback generation uses the public `https` scheme.
- Configure CORS to exact production origins.
- Configure allowed hosts for production domains.
- Add file-secret support for high-risk config.
- Add S3-compatible storage provider.
- Add readiness checks.
- Keep exception handler returning structured generic errors.

Nice-to-have:

- Structured JSON logging.
- Request IDs/correlation IDs.
- OpenTelemetry traces/metrics later.
- ProblemDetails response consistency.

## Frontend Production Hardening

Required changes:

- Fix scripts to build the real root app.
- Add web Dockerfile.
- Pin Node version.
- Ensure production API URL is configured explicitly.
- Ensure SignalR connects to production API origin.
- Verify SSR output runs under the selected Node runtime.
- Add smoke check for the built server.

Nice-to-have:

- CSP-compatible rendering.
- Sentry source maps.
- Lighthouse/basic accessibility check in CI later.

## Mobile Production Configuration

Production mobile builds must point to the production API base URL. This can be handled through Expo config and release channels/profiles.

The deployment spec does not need to build mobile apps automatically in v1, but it must document:

- Production API base.
- OAuth redirect expectations.
- Version compatibility with API changes.

## Backups

### Backup Types

Required:

- Daily encrypted logical Postgres backup.
- Object storage backup upload.
- Backup freshness check.
- Restore drill.

Recommended:

- WAL archiving or more frequent incrementals once usage grows.
- Hetzner VM snapshot as a convenience, not primary backup.

### Backup Storage

Backups must be encrypted before reaching Object Storage.

Recommended tools:

- `restic` for encrypted repository backups to S3-compatible storage.
- Or `pgBackRest` for Postgres-native backup and WAL workflows.

For v1, a pragmatic path is:

```text
pg_dump custom format
  -> compress
  -> restic backup to Hetzner Object Storage
  -> check backup exit code
  -> record backup timestamp
```

Retention:

- 7 daily.
- 5 weekly.
- 12 monthly.

### Restore Drills

At least monthly:

```text
1. Create temporary database/container.
2. Pull latest backup from Object Storage.
3. Decrypt and restore.
4. Run basic integrity queries.
5. Record restore result.
```

Acceptance rule: a backup strategy is not production-ready until a restore has succeeded.

## Observability

Minimum v1:

- Docker container healthchecks.
- External uptime check for web and API readiness.
- Sentry or equivalent for frontend/API exceptions.
- Caddy access/error logs.
- API structured logs.
- Backup freshness alert.
- Disk usage alert.
- CPU/RAM alert.
- Certificate expiry alert.

Recommended stack:

- Uptime Kuma or external hosted uptime monitor.
- Sentry for application exceptions.
- Netdata, Grafana Agent, or Prometheus node exporter for host metrics.
- Log rotation through Docker/Caddy/journald config.

Alerts should go to a real human channel, not just sit on the server.

## Security Controls

### Repository

- Protect `main`.
- Require PR before merge.
- Require CI checks.
- Disable force pushes to `main`.
- Enable Dependabot alerts and updates.
- Add secret scanning if available for the org/repo.

### GitHub Actions

- Least-privilege permissions.
- No production secrets in PR workflows.
- No `pull_request_target`.
- Pin third-party actions by SHA for hardened deployment workflows.
- Use GitHub environment `production`.
- Use deployment branch restrictions.
- Use concurrency to prevent overlapping deploys.

### Server

- SSH key auth only.
- Disable password login.
- Restrict SSH by source IP where practical.
- Use Hetzner firewall for ports:
  - 80/tcp public.
  - 443/tcp public.
  - SSH restricted.
  - Postgres not public.
- Enable unattended security updates or documented patch cadence.
- Run app containers as non-root where possible.
- Avoid mounting Docker socket into app containers.
- Keep secrets out of image layers.
- Keep secrets out of command-line arguments.

### Application

- Exact CORS origins.
- HTTPS-only public URLs.
- Secure OAuth redirect handling.
- Strong JWT signing key.
- Sensible token lifetimes.
- Auth/write/report rate limits.
- Cloudflare edge rules for abuse-prone endpoints once traffic patterns are known.
- Uploaded image validation and metadata stripping before object storage.

## Deployment Readiness Work Items

### Repo Hygiene

- Fix root README to describe the actual current repo.
- Fix `package.json` root scripts.
- Fix `Makefile`.
- Stop tracking `.env`.
- Ensure `.env.example` remains complete but non-secret.
- Add `.gitignore` entries for real env files and local secret files.

### Toolchain Pinning

- Add `.node-version` or `.nvmrc`.
- Add `global.json`.
- Document required Docker version.

### Containers

- Add API Dockerfile.
- Add web Dockerfile.
- Add production Compose file.
- Add Caddyfile.
- Add healthchecks.

### App Runtime

- Add forwarded headers.
- Add S3 image storage.
- Add file-secret config support.
- Add readiness health checks.
- Ensure production migrations run outside normal startup.

### CI/CD

- Add CI workflow.
- Add image publish workflow.
- Add production deploy workflow.
- Add remote deploy scripts.
- Add rollback scripts.

### Operations

- Add backup scripts.
- Add restore-drill script.
- Add server bootstrap doc.
- Add runbook for deploy failure.
- Add runbook for DB restore.
- Add runbook for secret rotation.

## Acceptance Criteria

Production is ready when all of these are true:

- `main` is protected and CI is required.
- A PR can run CI without production secrets.
- A merge to `main` builds and publishes web/API images to GHCR.
- A successful `main` build deploys automatically to Hetzner.
- Deploy uses immutable image tags or digests.
- Deploy has concurrency protection.
- Deploy health-checks web and API readiness.
- Failed deploy rolls back app images.
- Production secrets are not in GitHub except deploy-only SSH credentials.
- Runtime secrets are mounted as files per container where possible.
- A recovery copy of production secrets exists outside the VM.
- `.env` is no longer tracked.
- Uploaded images go to Object Storage.
- Postgres backups are encrypted and uploaded off the VM.
- A restore drill has succeeded.
- OAuth login works behind Cloudflare and Caddy.
- SignalR works through Cloudflare and Caddy.
- SMTP password reset works through the external email provider.
- Mobile config points at the production API.
- External uptime monitoring and backup freshness alerts are active.

## Rejected Approaches

### Multi-VM from day one

Rejected for v1 because the user explicitly chose a single VM and because Sheshi does not yet need the operational complexity of multi-node HA.

### Kubernetes

Rejected for v1 because it adds substantial operational surface without solving the most immediate risks: secrets, backups, object storage, deploy rollback, and observability.

### Coolify or Dokploy

Rejected for v1 because plain Compose and scripts are easier to audit, document, and reproduce for OSS contributors. A panel can be revisited later.

### Self-hosted email

Rejected because deliverability, abuse handling, IP reputation, DKIM/SPF/DMARC, and bounce handling are not worth owning for v1.

### Full secrets manager

Rejected for v1 because Vault/Infisical/1Password Connect would add another critical service. File secrets plus a recovery copy are enough for a single-VM deployment if permissions and runbooks are disciplined.

## Open Questions

- Final production domain name.
- Final Hetzner VM size.
- Whether GHCR images should be public or private.
- Whether Caddy runs as a host service or container.
- Whether backups use `restic` first or `pgBackRest` from the beginning.
- Which external SMTP provider to use.
- Which monitoring/alerting destination to use.
- Whether Cloudflare origin certs or Let's Encrypt certs are preferred at origin.

## Source References

- GitHub Actions secure use: https://docs.github.com/en/actions/reference/security/secure-use
- GitHub deployment environments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- GitHub Actions Docker publishing: https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
- Docker Compose secrets: https://docs.docker.com/compose/how-tos/use-secrets/
- Docker Compose environment variable guidance: https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/
- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- SOPS docs: https://getsops.io/docs/
- Hetzner Cloud: https://www.hetzner.com/cloud
- Hetzner Object Storage: https://www.hetzner.com/storage/object-storage/
- Hetzner DDoS protection: https://www.hetzner.com/unternehmen/ddos-schutz
- Microsoft SignalR scale guidance: https://learn.microsoft.com/en-us/aspnet/core/signalr/scale
- .NET support policy: https://dotnet.microsoft.com/en-us/platform/support/policy
