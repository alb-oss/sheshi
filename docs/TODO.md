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
- **Phase 2 auth backend**:
  - Added snake_case JSON API auth contracts.
  - Implemented Identity-backed register/login/refresh/logout.
  - Implemented JWT bearer auth, rotating hashed refresh tokens, and `/api/me` GET/PATCH.
  - Implemented forgot/reset password with an `IEmailSender` boundary and SMTP implementation.
  - Added config-gated OAuth provider discovery and external challenge/callback wiring for Google/Microsoft/Apple.
  - Added integration tests for token flow, profile updates, provider discovery, bad password rejection, and password reset.
- **Phase 3 core API + authorization backend**:
  - Added `/api/rooms`, `/api/rooms/{slug}`, room message list, message detail, replies, post, vote/unvote, soft-delete, report, and highlights endpoints.
  - Added `MessageService` read-model enrichment for author, upvotes, reply counts, and per-user voted state.
  - Ported key Supabase RLS/trigger rules into API/service checks: banned users cannot post/vote, votes only on top-level messages, one-level replies, and author/mod soft delete.
  - Added integration tests for rooms, message/reply/vote/report/highlight flow, and authorization rules.
- **Phase 4–6 realtime, image upload, moderation backend**:
  - Added SignalR `ChatHub`, room/thread groups, change notifications, presence tracker, and `/api/rooms/presence`.
  - Added local image storage behind `IImageStorage`, static `/uploads` serving, validation for jpeg/png/webp, size limits, and multipart message image posts.
  - Added `/api/mod/*` report queue, resolve/dismiss, ban/unban, user search, and admin-only moderator role management.
  - Added integration tests for SignalR change events, presence counts, image upload, moderation role enforcement, report resolution, bans, and role grants.
- **Phase 7 frontend rewire**:
  - Added `api-client`, `token-store`, and SignalR client plumbing.
  - Replaced frontend auth/profile/reset/OAuth callback routes with .NET API calls.
  - Replaced `src/lib/sheshi.ts` data access with REST calls to the .NET API.
  - Replaced room/thread realtime subscriptions with SignalR group joins.
  - Added live presence in the app shell, Composer image upload, image rendering, and `/moderim`.
  - Removed Supabase SDK/runtime integration, Supabase migrations, Lovable auth/error runtime code, and stale Supabase startup wiring.
- **Phase 8 polish in progress**:
  - Added config-only `SeedAdmin__Email`/`SeedAdmin__Password` startup bootstrap for a first admin account.
  - Aligned backend launch profile to `http://localhost:5080`, matching `.env.example` and `VITE_API_BASE_URL`.

## ☐ To do
- Run final verification: `cd server && dotnet test`, repo-root `npm run build`, stale-reference scan.
- Add/update `server/README.md`.
- Optional manual local smoke: `docker compose up -d`, `dotnet run --project server/Sheshi.Api`, `npm run dev`.

Per-task detail: `docs/plans/2026-06-08-dotnet-backend-implementation.md`.
