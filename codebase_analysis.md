# Sheshi — Codebase Analysis

*Generated 2026-06-10*

## 1. Project Overview

**Sheshi** ("the square" in Albanian — tagline *"Zëri qytetar live"* / "live civic voice") is a real-time, Reddit/forum-style public discussion platform with an Albanian-language UI. Users browse rooms (`dhoma`), open threads (`tema`), reply in nested trees, upvote, report content, and see live presence counts. Moderators/admins get a moderation workspace with analytics, report triage, and user management.

| Aspect | Choice |
|---|---|
| Project type | Full-stack web app (SPA + REST/WebSocket API) |
| Backend | ASP.NET Core (.NET 10) Web API + SignalR, EF Core 10, ASP.NET Identity |
| Database | PostgreSQL 17 (Npgsql provider) |
| Frontend | React 19 + TypeScript 5.9, Vite 7, Chart.js, lucide-react, `@microsoft/signalr` |
| Auth | JWT access tokens (15 min) + rotating refresh tokens (30 days), optional Google/Microsoft/Apple OAuth |
| Email | SMTP (Mailpit locally) for password reset |
| Tests | xUnit integration tests against Testcontainers Postgres |
| Infra | docker-compose (Postgres + Mailpit), nginx reverse-proxy config for 2 API instances |

Architecture pattern: **feature-foldered monolith** on the server (`Features/Messages`, `Features/Rooms`, `Features/Moderation`, plus `Auth`, `Realtime`, `Storage`, `Email`) with thin controllers delegating to services. The frontend is a **single-page app with hand-rolled routing** (no react-router) and centralized state in `App.tsx` (no Redux/Query libraries).

## 2. Directory Structure

```
sheshi/
├── docker-compose.yml        # Postgres 17 (host port 55432) + Mailpit (1025/8025)
├── .env.example              # Canonical config template (verified by a test!)
├── infra/nginx/sheshi.conf   # LB config: rate limits, security headers, ws upgrade for /hub
├── frontend/                 # React SPA (Vite, port 3001)
│   └── src/
│       ├── main.tsx          # Entry point
│       ├── App.tsx           # All app state, routing switch, data loading (536 lines)
│       ├── views.tsx         # Page components: Home, RoomView, ThreadView, Profile, ModerationView, AuthPage (861 lines)
│       ├── ui.tsx            # Reusable components: TopBar, RoomRail, Composer, ThreadCard, Dialogs (532 lines)
│       ├── api.ts            # Typed fetch client for every endpoint
│       ├── realtime.ts       # SignalR subscribe/unsubscribe helpers
│       ├── appHooks.ts       # useBrowserRoute, useThemePreference, useRealtimeRefresh
│       ├── appSupport.ts     # Route parsing, localStorage auth/saved-ids, hot-score sorting
│       ├── types.ts          # snake_case API types (mirrors server DTOs)
│       └── roles.ts          # hasRole / canModerate / canAdmin helpers
└── server/
    ├── Sheshi.sln
    ├── Sheshi.Api/
    │   ├── Program.cs        # Composition root: DI, JWT, OAuth, CORS, rate limiting, headers, migrations
    │   ├── Auth/             # AuthController, MeController, TokenService, JwtOptions, DTOs
    │   ├── Data/             # AppDbContext (IdentityDbContext), DbSeeder, design-time factory
    │   ├── Domain/           # ApplicationUser, Room, Message, Vote, Report, RefreshToken, enums
    │   ├── Features/
    │   │   ├── Messages/     # MessagesController, MessageService, HighlightsController, DTOs
    │   │   ├── Rooms/        # RoomsController, RoomService, DTOs
    │   │   └── Moderation/   # ModerationController (analytics, reports, bans, roles), DTOs
    │   ├── Realtime/         # ChatHub, PresenceTracker, RealtimeNotifier, group names
    │   ├── Storage/          # IImageStorage, LocalFileImageStorage (uploads/ on disk)
    │   ├── Email/            # IEmailSender, SmtpEmailSender (password reset, Albanian copy)
    │   └── Migrations/       # InitialSchema, ThreadMetadata (RootMessageId/Depth)
    └── Sheshi.Api.Tests/     # 14 integration tests (Testcontainers Postgres)
```

## 3. Data Model

- **ApplicationUser** (Identity, Guid keys) + `DisplayName`, `AvatarUrl`, `BannedAt` (soft ban).
- **Room** — slug-unique discussion channel; one seeded room `#sheshi`.
- **Message** — unified threads/replies. Root message has `ParentId = null`, `Depth = 0`, `RootMessageId = self`. Replies carry `RootMessageId` + `Depth` for cheap whole-thread fetches. Soft delete via `DeletedAt`. Body max 2000 chars. Optional `ImageUrl`.
- **Vote** — composite PK (MessageId, UserId); idempotent upvote via raw `INSERT … ON CONFLICT DO NOTHING`.
- **Report** — reason enum (spam/hate/doxxing/violence/other) + note, status open/resolved/dismissed.
- **RefreshToken** — SHA-256 hash only, expiry + revocation timestamps.

Smart indexing: filtered descending index `(RoomId, CreatedAt DESC, Id DESC) WHERE ParentId IS NULL` matches the room-feed query exactly; `(RootMessageId, CreatedAt, Id)` serves thread fetch.

## 4. API Surface

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/register`, `login`, `refresh`, `logout` | — / Bearer | "auth" rate policy (20/min prod) |
| `POST /api/auth/forgot-password`, `reset-password` | — | No account-existence leak |
| `GET /api/auth/providers`, `GET /api/auth/external/{provider}`, `/external/callback` | — | OAuth via short-lived external cookie, redirects to SPA with tokens in URL **fragment** |
| `GET/PATCH /api/me` | Bearer | Profile |
| `GET /api/rooms`, `GET /api/rooms/{slug}` | — | With thread counts + latest activity |
| `POST /api/rooms` | **admin** | Slug normalization, conflict check |
| `GET /api/rooms/{id}/messages` | optional | Cursor pagination (CreatedAt ticks) |
| `GET /api/messages/{id}`, `/replies`, `GET /api/threads/{id}` | optional | Full nested thread tree (cap 1000) |
| `POST /api/messages` | Bearer, not banned | JSON or multipart (image ≤5 MB, jpeg/png/webp) |
| `PUT/DELETE /api/messages/{id}/vote` | Bearer | Optimistic on the client |
| `DELETE /api/messages/{id}` | author or mod/admin | Soft delete |
| `POST /api/messages/{id}/report` | Bearer | |
| `GET /api/highlights?mode=focus|hot|fresh|top|replied` | optional | In-memory ranking over recent 500 messages |
| `GET /api/rooms/presence` | — | Snapshot of in-memory presence |
| `GET /api/mod/*` (analytics, reports, users, ban/unban, roles) | mod/admin (roles: admin-only) | "moderation" rate policy |
| `/hub` (SignalR) | optional (JWT via query) | `JoinRoom/LeaveRoom/JoinThread/LeaveThread`; emits `changed`, `message_changed`, `presence` |

JSON is `snake_case` end-to-end (configured serializer + matching TS types; enforced by `ModelParityTests`).

## 5. How It Works (request lifecycle)

1. **Startup**: validates JWT options (≥32-byte key, rejects the dev key outside Development), migrates DB (dev always; prod opt-in via `Database__AutoMigrate`), seeds roles + `#sheshi` room + optional `SeedAdmin` account.
2. **Pipeline**: security headers (CSP `default-src 'none'`, nosniff, frame-deny, COOP) → HTTPS redirect → routing → CORS allowlist → per-user-or-IP fixed-window rate limiting (5 named policies) → JWT auth → controllers/hub. Static `/uploads` served from local disk.
3. **Frontend**: `App.tsx` loads rooms + highlights + presence in parallel; per-route effects load room feed or thread; SignalR groups (`room:{id}`, `thread:{id}`) push `changed` events that debounce (250 ms) into a `refreshTick` re-fetch; a 15-second visibility-aware polling interval is the fallback. Votes are optimistic with rollback. Auth state, theme, and saved-message ids live in localStorage.
4. **Writes** flow controller → service → EF Core → `RealtimeNotifier` fan-out to room + thread groups.

## 6. Testing

14 integration tests boot the real app against throwaway Postgres containers (`ApiFactory`): full auth lifecycle, wrong-password rejection, OAuth provider listing, forgot/reset password (with a captured email sender), room seeding + admin-only creation, message/vote/report/highlight contract, cursor pagination + thread metadata, authorization parity with a prior Supabase RLS design, seed-admin bootstrap, SignalR presence + changed events, multipart image upload, and moderation role enforcement. Two clever meta-tests: `EnvTemplateTests` (keeps `.env.example` honest) and `ModelParityTests` (keeps TS types in sync with C# DTOs). **No frontend tests.**

## 7. Strengths

- Clean separation, small files, consistent feature-folder layout; result-object pattern instead of exceptions for domain errors.
- Serious security hygiene for an MVP: hashed rotating refresh tokens, startup secret validation, per-identity rate limiting, security headers at both nginx and app layer, CORS allowlist, forwarded-headers gated behind `KnownProxies`, streamed upload size cap with content-type allowlist and atomic temp-file moves, no account enumeration on forgot-password.
- Real integration tests against real Postgres, including SignalR and multipart flows.
- Thoughtful DB indexes matched to the actual query shapes; cursor pagination instead of offsets.
- Config-driven everything (`.env.example` is the single source of truth, test-enforced).

## 8. Gaps & Issues

### Security (most important first)
1. **OAuth account pre-registration takeover.** `ExternalCallback` links by email: an attacker can register `victim@example.com` with a password (no email verification exists). When the real owner later signs in with Google, they land in the attacker-controlled account (and vice versa, the attacker's password keeps working). Fix: require email confirmation for password registration, or refuse external sign-in into password accounts whose email is unverified.
2. **Soft-deleted message bodies still leak.** `ListRoomMessagesAsync`, `GetThreadAsync`, `ListRepliesAsync` and `GetMessageAsync` return messages with `DeletedAt` set but **`Body` and `ImageUrl` intact**. The frontend hides them; any API caller sees deleted (possibly doxxing) content. Blank the body server-side when `DeletedAt != null`.
3. **Banning is incomplete.** A banned user is only blocked from `POST /api/messages` and `PUT vote`. They can still **log in, refresh tokens, report, remove votes, and update their profile**. Banning also doesn't revoke their refresh tokens. Check `IsBanned` in login/refresh and revoke active tokens on ban.
4. **Tokens in localStorage + no refresh flow.** The SPA stores access+refresh tokens in localStorage (XSS-exfiltratable) and **never uses the refresh token** — after 15 minutes the session silently breaks until re-login. Logout also never calls `/api/auth/logout`, so refresh tokens linger server-side for 30 days. No refresh-token *reuse detection* (token-family revocation) either.
5. Upload content-type trusted from the client header (no magic-byte sniffing) — largely mitigated by extension-based serving + `nosniff`, but worth hardening.

### Scalability / infra coherence
6. **nginx config contradicts the app.** `sheshi.conf` load-balances `sheshi-api-1/2`, but: SignalR has **no backplane** (Redis), `PresenceTracker` is **in-memory per instance**, and uploads go to **local disk** — none of that works on 2+ instances. Also no sticky sessions for SignalR negotiate fallbacks. Either ship 1 instance or add a backplane + shared/object storage.
7. **`docker-compose.yml` only runs db + mailpit** — there are no Dockerfiles for the API or frontend, so the nginx upstream containers can't exist. Deployment story is incomplete.
8. **Moderation analytics loads entire tables into memory** (`Messages`, `Users`, `Votes`, `Reports` — all rows) per request. Fine at small scale, a time bomb later. Same for `HighlightsController` (500 seed + 5000 branch messages per anonymous request).
9. Every realtime `changed` event triggers clients to re-fetch rooms+highlights+feed; combined with 15 s polling per client this multiplies read load.

### Correctness (minor)
10. Cursor encodes only `CreatedAt` ticks with strict `<` — messages sharing a timestamp can be skipped across pages (ordering tiebreaks by Id, but the cursor doesn't).
11. `RoomService` "latest activity" includes soft-deleted messages; thread counts exclude them — slightly inconsistent.
12. Role grants/bans take up to 15 min to bite for already-issued JWTs (no claim re-check) — acceptable, but worth knowing.
13. Anonymous SignalR clients can join any room/thread group and inflate presence counts arbitrarily.

### Project hygiene
14. **Not a git repository** — no version control, no history, no rollback. (Highest-leverage fix available.)
15. **No CI/CD**, no root README (only `server/README.md`, which references a stale `alb_sheshi/` path), no LICENSE.
16. **No frontend tests** and `@types/react`/`@types/react-dom` were missing from `package.json`, so `npm run build` failed with 581 type errors (fixed during this analysis).
17. `frontend/dist/` and `server/**/bin|obj` artifacts are committed-in-place in the working tree.

## 9. Architecture Diagram

```
                ┌────────────────────────── Browser ──────────────────────────┐
                │  React 19 SPA (Vite, port 3001)                              │
                │  App.tsx state ── api.ts (fetch, Bearer) ── realtime.ts      │
                └───────────────┬──────────────────────────────┬──────────────┘
                                │ REST (snake_case JSON)       │ WebSocket /hub
                                ▼                              ▼
   [prod path: nginx ── rate limits, ws upgrade, 2x upstream (currently fictional)]
                                │                              │
                ┌───────────────▼──────────────────────────────▼──────────────┐
                │  Sheshi.Api (.NET 10, Kestrel :5080)                         │
                │  RateLimiter → JWT/OAuth auth → Controllers                  │
                │  Auth / Rooms / Messages / Highlights / Moderation / Me      │
                │        │ services            │ RealtimeNotifier              │
                │        ▼                     ▼                               │
                │   EF Core (Npgsql)      ChatHub + PresenceTracker (memory)   │
                │        │                LocalFileImageStorage → ./uploads    │
                └────────┼─────────────────────────────────────────────────────┘
                         ▼                          ▼
                  PostgreSQL 17               Mailpit SMTP (password reset)
                  (docker, :55432)            (docker, :1025 / UI :8025)
```

## 10. Verdict & Recommendations

The backend is **well-built for its stage** — clean, consistently structured, security-conscious, and unusually well-tested for a side project. It is *fine for local/small-scale use*. Before any public deployment, address in this order:

1. `git init` + push to a remote; add CI running `dotnet test` + `npm run build`.
2. Blank soft-deleted message bodies in API responses.
3. Enforce bans at login/refresh and revoke tokens on ban.
4. Close the OAuth/email account-linking takeover (email verification).
5. Implement the client refresh-token flow (and call logout).
6. Reconcile infra: either single-instance deployment docs, or Redis backplane + object storage + Dockerfiles.
7. Replace in-memory analytics/highlights scans with aggregate SQL queries when usage grows.
