# Sheshi .NET Rewrite — TODO

Branch: `feat/dotnet-backend`. Full context: `docs/sheshi-dotnet-backend-master-spec.md`.

## ✅ Done
- Cloned repo; created branch `feat/dotnet-backend` off `main`.
- Design + plan + consolidated master spec committed under `docs/`.
- **Phase 0–1 backend foundation** (both spec + quality review passed):
  - `docker-compose.yml` (Postgres 17 + Mailpit) and `.env.example`.
  - `server/` solution: `Sheshi.Api` (controllers, .NET 10) + `Sheshi.Api.Tests` + `Sheshi.sln`.
  - 7 domain entities, `AppDbContext`, initial EF migration, role/room seeder (5 rooms + 3 roles, exact Albanian strings).
  - `/health` endpoint + Testcontainers smoke test (build green, 1/1 test pass).
  - Commits: `6af4071`, `cfc105d`, `447219f`, `1f8138d`, `7964f21`, `07d4ec1`.
  - Note: compose DB mapped to host port **55432** (host already uses 5432).
- **Phase 0–1 review fixes**:
  - Added `Vote.UserId` → user, `Report.MessageId` → message, and `Report.ReporterId` → user FKs.
  - Regenerated the initial EF migration and snapshot.
  - Aligned `.env.example` to port `55432`.
  - Made `(RoomId, CreatedAt)` use `CreatedAt DESC`.
  - Adjusted `ApiFactory` async lifetime disposal and wrapped startup migrate/seed with logging.
  - Added regression tests for the EF parity/config fixes.

## ☐ To do — remaining build phases (not started)
- **Phase 2** — Auth: Identity + JWT + refresh, register/login/logout, password reset, OAuth (Google/Apple/Microsoft), `/me`.
- **Phase 3** — Core API + authorization: rooms, messages (read/post), votes, soft-delete, reports, highlights; RLS→service-layer rules.
- **Phase 4** — SignalR `ChatHub` + change broadcasts + live presence counts.
- **Phase 5** — Image upload (`IImageStorage` + local filesystem) wired into post message.
- **Phase 6** — Moderation: report queue, ban/unban, admin-only role management.
- **Phase 7** — Frontend rewire off Supabase: `api-client`, `token-store`, `sheshi.ts`, `use-auth`, auth/reset/profile routes, SignalR, presence, Composer image picker, `/moderim` dashboard; remove Supabase/Lovable. (Needs `bun` — not installed; `npm` fallback available.)
- **Phase 8** — Integration test pass, `server/README.md` + admin seed, finish the branch.

Per-task detail: `docs/plans/2026-06-08-dotnet-backend-implementation.md`.
