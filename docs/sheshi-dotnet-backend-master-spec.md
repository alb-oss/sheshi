# Sheshi — .NET Backend Rewrite — Master Spec, Plan & Status

**One consolidated document.** It contains: the user's requests & requirements, the
full architecture/spec, the full implementation plan, and a running record of what has
actually been applied. It is the single source of truth for this effort.

- **Branch:** `feat/dotnet-backend` (off `main`)
- **Started:** 2026-06-08
- **Companion docs (working sources):**
  - `docs/plans/2026-06-08-dotnet-backend-design.md` (design)
  - `docs/plans/2026-06-08-dotnet-backend-implementation.md` (task-by-task plan)
- **Execution method:** Subagent/Workflow orchestration (ultracode), one workflow per phase,
  each with implement → spec-review → quality-review fix loops.

> **Status at a glance:** Design ✅ · Plan ✅ · Phase 0–1 foundation **complete** (spec + quality review passed; review follow-ups being applied) · Phases 2–8 pending. Full changelog in **Part E**.

---

# Part A — The Request & Requirements

## A.1 What the user asked for (verbatim intent)

1. *"i just became a collaborator on this app … can you pull or clone it here?"* — clone
   `https://github.com/JoziGila/sheshi.git` into the working directory. **Done.**
2. *"can you now rewrite the backend for me in .net"* — replace the current Supabase
   backend with a .NET backend.
3. *"make sure to do it in a local branch first and first of all lets brainstorm a bit
   to know all the features"* — work on a local branch; brainstorm the full feature set
   before building.
4. *"make sure that the .net will be a single folder and super well structured. it shall
   use api's and either minimal apis or controllers … controllers would be better."* —
   single top-level backend folder, clean structure, **controllers**.
5. *"can we make it so that the react frontend in the future will be a spa even with .net
   api?"* — **Answer: Yes.** A .NET JSON API + a pure client-side React SPA is the most
   common pairing. The rewire (all data/auth/realtime behind an `api-client` + SignalR,
   no server-coupled fetching) makes dropping TanStack Start's SSR for a static SPA
   straightforward later. Recorded as a forward-looking requirement (not built now).
6. *"also use workflows to do this"* + ultracode effort — orchestrate the build with the
   Workflow tool, optimizing for exhaustive correctness; one workflow per phase with
   independent spec + quality review.

## A.2 Decisions captured (the brainstorm)

Every decision below was explicitly chosen by the user during the brainstorm.

| # | Question | Decision |
|---|---|---|
| 1 | How far should the rewrite go? | **Backend + rewire the React frontend** off the Supabase SDK so it runs end-to-end |
| 2 | Auth model | **Full OAuth parity** — ASP.NET Core Identity, email/password + reset, **Google/Apple/Microsoft** |
| 3 | Data-access + DB stack | **EF Core + PostgreSQL** (schema ported from existing migrations) |
| 4 | Faithful port vs. finish latent features | **Port + finish latent features** |
| 5 | Image storage | **Local filesystem**, behind a swappable `IImageStorage` interface |
| 6 | Moderation dashboard scope | **Reports + ban/unban + admin-only role management** |
| 7 | Presence "online" count meaning | **Live connected viewers** per room (signed-in or anonymous) via SignalR |
| 8 | Frontend token model | **Access + refresh tokens in `localStorage`**, silent refresh |
| 9 | Backend structure | **Single `server/` folder**, **controllers** (not minimal APIs) |
| 10 | Realtime mechanism | **SignalR** (replaces Supabase realtime) |
| 11 | .NET version | **.NET 10** (current LTS; SDK 10.0.203 verified locally) |

## A.3 Latent features being finished (consequence of decision #4)

Three things existed in the Supabase schema/UI but were not fully built; the rewrite
completes them:

1. **Image attachments** — `image_url` existed and was rendered, but there was no upload
   UI or storage. → Real upload (local filesystem) + Composer image picker.
2. **Moderation dashboard** — reports/roles/policies existed but no admin screen. → New
   gated `/moderim` route + `/mod/*` endpoints (reports, ban/unban, admin role mgmt).
3. **Presence counts** — sidebar `1.2k`/`URGJENT` numbers were hardcoded fakes. → Real
   live connected-viewer counts via SignalR.

## A.4 Cross-cutting constraints

- All work on branch `feat/dotnet-backend`; never on `main`; no pushes/merges without
  the user asking.
- Backend = single `server/` folder; controllers; .NET 10; EF Core + Npgsql.
- Frontend keeps its UI/markup; only data/auth/realtime sources are swapped.
- No data migration from the existing Supabase project (treated as a fresh DB).
- Secrets (OAuth, SMTP, JWT key) are filled into `.env` by the maintainer.

---

# Part B — The backend being replaced (Supabase) — feature inventory

The React app currently talks to **Supabase directly** via `@supabase/supabase-js`
(`supabase.from(...)`, realtime channels, auth in `localStorage`). Features:

**Identity & auth:** email/password sign-up (+ email confirmation) & sign-in; OAuth
(Google in UI; Lovable layer also Apple/Microsoft); password reset; sign-out; auto
profile + `user` role on signup (DB trigger `handle_new_user`); profile (view email,
edit `display_name`, auto username); roles `user`/`moderator`/`admin`; ban via
`banned_at` (blocks posting/voting; can't self-unban).

**Rooms:** seeded `sheshi`, `vjosa-narta`, `tirana`, `shkodra`, `korca`; list + by-slug.

**Messages:** top-level per room (latest 80, shown oldest→newest); post (1–2000 chars,
banned blocked); one-level threaded replies (`parent_id`) with @mention prefill;
soft-delete (author own / mod any).

**Votes:** upvote toggle, top-level only (DB trigger `enforce_vote_on_main`); one per
user per message; counts via `message_stats` view; per-user `voted` state.

**Reports/moderation:** report (spam/hate/doxxing/violence/other + note); statuses
(open/resolved/dismissed) readable by mods/admins (no UI — DB only).

**Highlights ("Në Fokus"):** Hot (`(up + replies·2)/ageH^1.3`), Top (by upvotes),
Replied (by reply count) — currently client-side; right-rail panel + `/fokus` page.

**Realtime:** live updates on messages & votes (per-room + per-thread channels),
debounced reload.

**Security:** enforced in the DB via **Row-Level Security (RLS)** policies + triggers +
`has_role()`/`is_banned()` functions. (In the rewrite this moves to the service layer —
see Part C §6.)

---

# Part C — Design / Spec

## C.1 Repo layout
Monorepo; React app stays, backend lands beside it in one folder.
```
/ (repo root)
├─ src/                      # existing React app (rewired, not rebuilt)
├─ server/                   # .NET solution (single backend folder)
│  ├─ Sheshi.Api/            # ASP.NET Core Web API + SignalR (.NET 10, controllers)
│  ├─ Sheshi.Api.Tests/      # xUnit integration tests
│  └─ Sheshi.sln
├─ docker-compose.yml        # local Postgres (+ Mailpit) for dev
└─ docs/                     # this file + plans/
```
Feature-organized inside `Sheshi.Api`: `Domain/`, `Data/`, `Auth/`, `Email/`,
`Storage/`, `Realtime/`, `Features/{Rooms,Messages,Moderation}/`.

## C.2 Data model (EF Core, Postgres)
ASP.NET Identity replaces Supabase `auth.users` **and** the `user_roles` table.
- **`ApplicationUser : IdentityUser<Guid>`** + `DisplayName`, `AvatarUrl`, `BannedAt`,
  `CreatedAt` (`UserName` = old username, `Email` = email).
- **Roles** via Identity roles `user`/`moderator`/`admin` → replaces `app_role` enum +
  `user_roles` + `has_role()`.
- **`Room`** (Id, Slug unique, Name, Description, CreatedAt).
- **`Message`** (Id, RoomId, AuthorId, ParentId nullable self-FK, Body 1–2000, ImageUrl,
  DeletedAt, CreatedAt; indexes: `(RoomId, CreatedAt) where ParentId is null`, `ParentId`).
- **`Vote`** (composite PK (MessageId, UserId), CreatedAt).
- **`Report`** (Id, MessageId, ReporterId, Reason enum, Note ≤500, Status enum, CreatedAt).
- **`RefreshToken`** (Id, UserId, TokenHash, ExpiresAt, RevokedAt, CreatedAt).

`message_stats` (upvotes + reply_count) → computed via LINQ aggregation in the service
layer (not a DB view). EF migrations recreate the schema; a seeder ensures roles + the 5
rooms with the **exact** Albanian strings from `supabase/migrations`. The two Postgres
triggers become service-layer logic (§C.6).

## C.3 REST API surface
All under `/api`, JSON (snake_case to match the existing frontend types), bearer auth.

| Method & path | Purpose | Auth |
|---|---|---|
| `POST /auth/register` | email/password sign-up | anon |
| `POST /auth/login` | → access + refresh token | anon |
| `POST /auth/refresh` | rotate tokens | refresh |
| `POST /auth/logout` | revoke refresh token | user |
| `POST /auth/forgot-password` / `reset-password` | email reset flow | anon |
| `GET /auth/external/{provider}` → `/auth/external/callback` | Google/Apple/Microsoft OAuth | anon |
| `GET /auth/providers` | enabled OAuth providers (UI shows/hides buttons) | anon |
| `GET /me` · `PATCH /me` | current profile; edit display_name | user |
| `GET /rooms` · `GET /rooms/{slug}` | list / fetch room | anon |
| `GET /rooms/{id}/messages` | top-level, latest 80 | anon |
| `GET /messages/{id}` · `GET /messages/{id}/replies` | thread parent + replies | anon |
| `POST /messages` | post message/reply (multipart if image) | user |
| `DELETE /messages/{id}` | soft-delete (author or mod) | user |
| `PUT /messages/{id}/vote` · `DELETE …/vote` | toggle upvote | user |
| `POST /messages/{id}/report` | file report | user |
| `GET /highlights?mode=hot\|top\|replied` | ranked list (server-side now) | anon |
| `GET /rooms/presence` | current per-room live counts | anon |
| `GET /mod/reports` · `POST /mod/reports/{id}/resolve\|dismiss` | report queue | mod/admin |
| `POST /mod/users/{id}/ban` · `/unban` | ban control | mod/admin |
| `GET /mod/users?query=` · `POST /mod/users/{id}/roles` | search / grant-revoke moderator | **admin** |

Message responses include `author`, `upvotes`, `reply_count`, `voted` — matching the
current `MessageRow` shape so frontend types barely change.

## C.4 Auth
ASP.NET Core Identity + JWT. Login issues a short-lived **access token (~15 min)** + a
rotating **refresh token** (hashed + revocable in DB). Frontend stores both in
`localStorage`, refreshes silently. **OAuth**: API runs the provider handshake, then
**302** to `${Frontend}/auth/callback#access_token=…&refresh_token=…` (mirrors the old
`setSession(tokens)`). Each provider is config-gated (enabled only if its client id/secret
exist) — ship Google first; Apple needs an Apple Developer account + key-signed client
secret.

## C.5 Realtime (SignalR)
One `ChatHub` at `/hub`. Clients join groups `room:{roomId}` / `thread:{messageId}`.
On writes the API broadcasts a `changed` signal to the relevant group(s); the client
re-fetches (keeps today's debounced reload). **Presence**: the hub tracks connection
counts per `room:{roomId}` → live `presence` events + `GET /api/rooms/presence` for
initial render. Replaces the hardcoded sidebar counts.

## C.6 Authorization (replaces Supabase RLS — critical)
RLS moves to explicit **service-layer** checks. Direct ports:
- **Post / vote** → must be authenticated and **not banned** (`is_banned`).
- **Vote target** → must be top-level (`enforce_vote_on_main`).
- **Soft-delete** → author *or* moderator/admin.
- **Profile self-update** → may change `display_name`, never `banned_at`/roles (can't self-unban).
- **Reports** → any user files; only mod/admin reads/actions the queue.
- **Signup / first OAuth login** → create profile fields + assign `user` role
  (`handle_new_user`).

## C.7 Image upload
`POST /messages` multipart (text + optional image). API validates type
(jpeg/png/webp) + size (≈5 MB) and stores via `IImageStorage`; sole impl
`LocalFileImageStorage` writes under a configured folder, served at `/uploads`. Swap to
S3/Azure later = one class. Composer gains a picker + preview.

## C.8 Moderation dashboard
New gated route `/moderim` (moderator/admin). Tabs: **Reports** (queue + context →
resolve/dismiss/delete message), **Users** (search → ban/unban), **Roles** (admin-only →
grant/revoke moderator). Backed by `/mod/*`.

## C.9 Frontend rewire (changes in `src/`)
- New `src/lib/api-client.ts` (bearer + auto-refresh on 401) and `src/lib/token-store.ts`.
- `src/lib/sheshi.ts` — same exports/types; bodies call the API (drop `attachMeta`; server
  returns enriched DTOs).
- `src/hooks/use-auth.ts` — same shape; backed by token store + `/api/me`.
- New `src/lib/realtime.ts` (SignalR `HubConnection`); room/thread routes swap channels for
  hub groups.
- `src/components/AppShell.tsx` — live presence instead of `ROOM_META` fakes.
- `src/components/Composer.tsx` — image picker; new `src/routes/moderim.tsx`; new
  `src/routes/auth.callback.tsx`.
- Remove `src/integrations/supabase/*` + `integrations/lovable/*`; drop
  `@supabase/supabase-js` + `@lovable.dev/*`; delete `supabase/` dir.

## C.10 Dev & config
`docker-compose.yml` runs Postgres (+ Mailpit). Config via `appsettings.json` + env
(connection string, JWT key, OAuth secrets, SMTP, upload path/limits, CORS). `.env.example`
documents all of it. Dev email → Mailpit (`http://localhost:8025`).

## C.11 Testing
xUnit + `WebApplicationFactory` + Testcontainers Postgres: auth round-trip; post/vote/
report flows; the §C.6 authorization rules (banned can't post, can't vote on replies,
can't self-unban, mod-only endpoints reject normal users); highlights ranking; presence.

## C.12 Out of scope / flagged
- No Supabase data migration (fresh DB). Copying current rows = separate add-on.
- Email needs a chosen SMTP provider in prod (Mailpit in dev).
- Apple OAuth requires paid Apple Developer credentials; provider is config-gated.

---

# Part D — Implementation Plan (phases & tasks)

> Full task-by-task detail with exact code, commands, and TDD steps lives in
> `docs/plans/2026-06-08-dotnet-backend-implementation.md`. Summary of every phase/task:

**Phase 0 — Prereqs & dev infra**
- 0.1 Verify toolchain (.NET 10, Docker, bun). 0.2 `docker-compose.yml` (Postgres+Mailpit) + `.env.example`.

**Phase 1 — Scaffold & data model**
- 1.1 Solution + `Sheshi.Api` (controllers) + `Sheshi.Api.Tests` + NuGet deps.
- 1.2 Domain entities. 1.3 `AppDbContext` + entity config. 1.4 Initial migration + role/room
  seeder + DbContext registration. 1.5 Testcontainers `ApiFactory` + `/health` smoke test;
  `public partial class Program`.

**Phase 2 — Auth**
- 2.1 Identity + JWT wiring + `TokenService` (access + rotating refresh). 2.2
  register/login/refresh/logout + DTOs + `UserService`. 2.3 password reset (Identity tokens +
  `IEmailSender`/SMTP). 2.4 OAuth external login (Google/Microsoft/Apple, config-gated) +
  `/auth/providers`. 2.5 `/me` GET/PATCH.

**Phase 3 — Core API + authorization**
- 3.1 Rooms. 3.2 Message read model + stats projection (DTO mirrors `MessageRow`, snake_case
  JSON). 3.3 Post message (ban check, body 1–2000, parent top-level). 3.4 Votes (main-only +
  ban). 3.5 Soft-delete (author/mod). 3.6 Reports. 3.7 Highlights (server-side ranking).

**Phase 4 — SignalR + presence**
- 4.1 `ChatHub` + change broadcasts (JWT over query string for websockets). 4.2 Presence
  tracker + `presence` events + `GET /rooms/presence`.

**Phase 5 — Image upload**
- 5.1 `IImageStorage` + `LocalFileImageStorage` + static serving at `/uploads`. 5.2 Wire image
  into `POST /messages`.

**Phase 6 — Moderation**
- 6.1 Report queue (`[Authorize(Roles="moderator,admin")]`). 6.2 Ban/unban. 6.3 Role
  management (admin only) + user search.

**Phase 7 — Frontend rewire**
- 7.1 `api-client` + `token-store`. 7.2 `use-auth` on the API. 7.3 `sheshi.ts` on the API.
  7.4 auth/reset/profile routes + `auth.callback`. 7.5 SignalR in room/thread routes. 7.6
  presence in sidebar. 7.7 Composer image upload + `/moderim` dashboard. 7.8 remove
  Supabase/Lovable; `bun run build` green.

**Phase 8 — Integration, docs, polish**
- 8.1 End-to-end manual run (register→post→vote→reply→highlights→report→moderate→image→
  presence). 8.2 admin-seed arg + `server/README.md`. 8.3 full test pass + `bun run build`.
  8.4 finish the branch (merge/PR decision).

Each phase is executed by a dedicated **workflow**: implement → verify build/test →
independent **spec-compliance** review (re-runs build/test) → bounded fix loop →
**code-quality** review (`code-reviewer` agent) → bounded fix loop.

---

# Part E — Applied / Changelog (what has actually been done)

> Update this section as phases land. Reflects real git state on `feat/dotnet-backend`.

### ✅ Setup
- Cloned `JoziGila/sheshi` into the working directory.
- Created branch `feat/dotnet-backend` off `main` (clean tree).

### ✅ Design & plan (committed)
- `fcb60d0` docs: add .NET backend rewrite design
- `1ad6a5b` docs: add .NET backend implementation plan
- (this file) consolidated master spec under `docs/`.

### ✅ Phase 0–1 — Foundation (complete; both reviews passed)
Implemented + reviewed by workflow `wf_ae285000-70e` (implement → spec review → quality
review). Spec review: **PASS** (independently re-ran `dotnet build` + `dotnet test`).
Quality review: **PASS** with non-blocking nits (below). Commits landed:
- `6af4071` chore: add docker-compose (postgres+mailpit) and env template
- `cfc105d` chore: scaffold .NET solution (Api + Tests) with deps
- `447219f` feat(api): domain entities
- `1f8138d` feat(api): AppDbContext + entity config
- `7964f21` feat(api): initial EF migration + role/room seeder
- `07d4ec1` test(api): WebApplicationFactory + Testcontainers smoke test

State: `server/` scaffolded (`Sheshi.Api`, `Sheshi.Api.Tests`, `Sheshi.sln`); `dotnet build`
green; `/health` Testcontainers smoke test passing (1/1); Postgres via docker-compose; 5 rooms
+ 3 roles seeded with exact Albanian strings (diacritics verified).

**Important deviation — DB port:** this machine already runs a native Postgres on `5432`, so
the compose container is mapped to host port **`55432`** (appsettings + design-time factory
match). On a clean machine without a host Postgres, `5432` also works. Use `55432` locally.

**Review follow-ups (applied next, in a fix commit):**
- (important) Add missing FKs to match Supabase parity: `Vote.UserId`→user (cascade),
  `Report.MessageId`→message (cascade), `Report.ReporterId`→user (restrict); regenerate the
  initial migration.
- (important) Align `.env.example` connection port to `55432`.
- (minor) `(RoomId, CreatedAt)` index → `CreatedAt DESC` (matches design + original).
- (minor) `ApiFactory.DisposeAsync` ordering (base before container; explicit `IAsyncLifetime`).
- (minor) try/catch + logging around startup migrate+seed in `Program.cs`.

Extra intentional, minimal additions made by the implementer (all justified): a
`DesignTimeDbContextFactory` (so `dotnet ef` works), a minimal `AddIdentityCore`+roles+EF stores
in `Program.cs` (seeder needs `RoleManager`; full Identity/JWT wiring comes in Phase 2),
removal of the `WeatherForecast` template sample, and a `server/.gitignore` re-including
`Sheshi.sln` (root `.gitignore` has a global `*.sln` rule).

### ☐ Pending
- Phase 2 — Auth (Identity, JWT, refresh, OAuth, `/me`)
- Phase 3 — Core API + authorization
- Phase 4 — SignalR + presence
- Phase 5 — Image upload
- Phase 6 — Moderation
- Phase 7 — Frontend rewire (note: requires `bun` — not yet installed; `npm` fallback available)
- Phase 8 — Integration, docs, polish

### Known follow-ups / risks
- `bun` is not installed locally; needed for Phase 7 frontend build (or use `npm` via the
  committed `package-lock.json`).
- OAuth (esp. Apple) + SMTP secrets must be provided by the maintainer in `.env`.
- No data migration from Supabase (fresh DB by decision).

---

# Part F — References
- Design: `docs/plans/2026-06-08-dotnet-backend-design.md`
- Implementation plan (full code/commands): `docs/plans/2026-06-08-dotnet-backend-implementation.md`
- Original Supabase schema: `supabase/migrations/*.sql`
- Frontend entry points rewired: `src/lib/sheshi.ts`, `src/hooks/use-auth.ts`, `src/routes/*`,
  `src/components/{AppShell,Composer,MessageCard,HighlightsPanel,ReportDialog}.tsx`
