# Sheshi

Sheshi is an open-source civic discussion app with a TanStack Start frontend and
an ASP.NET Core API.

## Local Development

```bash
npm ci
npm run dev
```

The frontend dev server runs from the root app. The API lives under
`server/Sheshi.Api` and is built through `server/Sheshi.sln`.

## Common Commands

```bash
npm run frontend:build
npm run backend:build
npm run backend:test
npm run build
make build
```

## Production Deployment

The production deployment design is documented in:

- `docs/superpowers/specs/2026-06-14-hetzner-production-design.md`
- `docs/superpowers/plans/2026-06-14-hetzner-production-implementation.md`
- `docs/ops/hetzner-production.md`
- `docs/ops/secret-rotation.md`
- `docs/ops/backup-restore.md`

Production targets one Hetzner VM with Docker Compose and Caddy. Uploaded media
and encrypted backups use Cloudflare R2.

## Generated Paths

Do not commit dependency, build, or runtime output:

- `node_modules/`
- `dist/`
- `.output/`
- `server/**/bin/`
- `server/**/obj/`
- runtime uploads and local secret files
