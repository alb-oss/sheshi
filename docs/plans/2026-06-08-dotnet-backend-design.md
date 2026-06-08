# Sheshi — .NET Backend Rewrite Design

**Date:** 2026-06-08
**Branch:** `feat/dotnet-backend`
**Status:** Approved (brainstorm complete) — next step: implementation plan

## Goal

Replace the Supabase backend (Postgres + Auth + Realtime, accessed directly by the
React app via the `@supabase/supabase-js` SDK) with a self-owned **ASP.NET Core**
backend, and rewire the existing React/TanStack Start frontend to consume it. Port
all current features faithfully **and** finish three latent features (image upload,
moderation dashboard, live presence counts).

## Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Scope | .NET backend **+** rewire the React frontend off the Supabase SDK |
| Auth | ASP.NET Core Identity; email/password + reset; **Google/Apple/Microsoft OAuth** |
| Data access | EF Core + PostgreSQL (schema ported from existing migrations) |
| Realtime | SignalR (replaces Supabase realtime) |
| Feature scope | Faithful port **+** finish latent features |
| Image storage | Local filesystem, behind a swappable `IImageStorage` interface |
| Mod dashboard | Report queue + ban/unban + **admin-only** role management |
| Presence | Live connected viewers per room (signed-in or anonymous) via SignalR |
| Token model | Access + refresh tokens in `localStorage`, silent refresh |
| .NET version | .NET 10 (current LTS) |

## 1. Repo layout

Monorepo; React app stays, backend lands beside it.

```
/ (repo root)
├─ src/                      # existing React app (rewired, not rebuilt)
├─ server/                   # NEW — .NET solution
│  ├─ Sheshi.Api/            # ASP.NET Core Web API + SignalR (.NET 10)
│  ├─ Sheshi.Api.Tests/      # xUnit integration tests
│  └─ Sheshi.sln
├─ docker-compose.yml        # NEW — local Postgres (+ optional Mailpit) for dev
└─ docs/plans/2026-06-08-dotnet-backend-design.md
```

Single vertical-sliced API project (Controllers + Services + EF `DbContext`), not
over-layered.

## 2. Data model (EF Core, Postgres)

ASP.NET Identity replaces Supabase `auth.users` **and** the `user_roles` table.

- **`ApplicationUser : IdentityUser<Guid>`** — adds `DisplayName`, `AvatarUrl`,
  `BannedAt`, `CreatedAt`. `UserName` = old `username`, `Email` = email.
- **Roles** via Identity roles: `user`, `moderator`, `admin` → replaces `app_role`
  enum + `user_roles` table + `has_role()` function.
- **`Room`** — Id, Slug (unique), Name, Description, CreatedAt.
- **`Message`** — Id, RoomId, AuthorId→User, ParentId→Message (self, nullable),
  Body (1–2000), ImageUrl, DeletedAt, CreatedAt.
  Indexes: `(room_id, created_at desc) where parent_id is null`; `parent_id`.
- **`Vote`** — (MessageId, UserId) composite PK, CreatedAt.
- **`Report`** — Id, MessageId, ReporterId, Reason (enum), Note (≤500),
  Status (enum: open/resolved/dismissed), CreatedAt.

`message_stats` (upvotes + reply_count) → computed via LINQ aggregation in the
service layer (not a DB view). EF Core migrations recreate the schema; a seeder
inserts the 5 rooms (`sheshi`, `vjosa-narta`, `tirana`, `shkodra`, `korca`). The two
Postgres triggers become service-layer logic (see §6).

## 3. REST API surface

All under `/api`, JSON, `Authorization: Bearer`.

| Method & path | Purpose | Auth |
|---|---|---|
| `POST /auth/register` | email/password sign-up | anon |
| `POST /auth/login` | → access + refresh token | anon |
| `POST /auth/refresh` | rotate tokens | refresh |
| `POST /auth/logout` | revoke refresh token | user |
| `POST /auth/forgot-password` / `reset-password` | email reset flow | anon |
| `GET /auth/external/{provider}` → `/auth/external/callback` | Google/Apple/Microsoft OAuth | anon |
| `GET /me` · `PATCH /me` | current profile; edit display_name | user |
| `GET /rooms` · `GET /rooms/{slug}` | list / fetch room | anon |
| `GET /rooms/{id}/messages` | top-level, latest 80 | anon |
| `GET /messages/{id}` · `GET /messages/{id}/replies` | thread parent + replies | anon |
| `POST /messages` | post message/reply (multipart if image) | user |
| `DELETE /messages/{id}` | soft-delete (author or mod) | user |
| `PUT /messages/{id}/vote` · `DELETE …/vote` | toggle upvote | user |
| `POST /messages/{id}/report` | file report | user |
| `GET /highlights?mode=hot\|top\|replied` | ranked list (server-side now) | anon |
| `GET /mod/reports` · `POST /mod/reports/{id}/resolve\|dismiss` | report queue | mod/admin |
| `POST /mod/users/{id}/ban` · `/unban` | ban control | mod/admin |
| `POST /mod/users/{id}/roles` | grant/revoke moderator | **admin** |
| `GET /sitemap.xml` | stays (API or TS) | anon |

Message responses include `author`, `upvotes`, `reply_count`, `voted` — matching the
current `MessageRow` shape so frontend types barely change.

## 4. Auth

ASP.NET Core Identity + JWT. Login issues a short-lived **access token (~15 min)** +
a rotating **refresh token** (stored hashed in DB, revocable). Frontend keeps both in
`localStorage` and refreshes silently. **OAuth**: API runs the provider handshake,
then redirects to frontend `/auth/callback#access_token=…&refresh_token=…` (mirrors
the old Lovable `setSession(tokens)`). Each provider is config-driven — enabled only
if its client id/secret are present (ship Google first, add Apple/Microsoft later).
Apple is the fiddliest: needs an Apple Developer account + key-signed client secret.

## 5. Realtime (SignalR)

One `ChatHub` at `/hub`. Clients join groups `room:{roomId}` and `thread:{messageId}`.
API broadcasts on writes:
- new/edited/deleted message → `room:{roomId}` (+ `thread:{parentId}` for replies)
- vote change → relevant room/thread

Frontend swaps `supabase.channel(...).on("postgres_changes")` for hub group joins;
the existing debounced-reload pattern stays. **Presence**: hub tracks connection
counts per `room:{roomId}` group → replaces the hardcoded `ROOM_META` fakes.

## 6. Authorization (replaces Supabase RLS — critical)

RLS moves to the **service layer**, enforced explicitly. Direct ports:

- **Post / vote**: must be authenticated and **not banned** (`is_banned` → `BannedAt != null`).
- **Vote target**: must be a top-level message (replaces `enforce_vote_on_main` trigger).
- **Soft-delete**: author *or* moderator/admin; authors delete only, mods may act on others.
- **Profile self-update**: user may change `display_name`, **not** `banned_at`
  (only mod endpoints) — replaces the "can't self-unban" policy.
- **Reports**: any user files; only mod/admin reads/actions the queue.
- **Signup**: on register / first OAuth login, create profile fields + assign `user`
  role — replaces the `handle_new_user` trigger.

## 7. Image upload

`POST /messages` accepts multipart (text + optional image). API validates type
(jpeg/png/webp) and size (≈5 MB cap), stores via `IImageStorage`; sole implementation
is `LocalFileImageStorage` (configured folder, served at `/uploads/...`). Swap to
S3/Azure later = one new class. Composer gains an image picker + preview.

## 8. Moderation dashboard

New gated route `/moderim` (moderator/admin). Tabs: **Reports** (queue + context →
resolve / dismiss / delete message), **Users** (search → ban/unban), **Roles**
(admin-only → grant/revoke moderator). Backed by `/mod/*` endpoints.

## 9. Frontend rewire (changes in `src/`)

- **New `src/lib/api-client.ts`** — fetch wrapper: base URL, bearer header, auto-refresh on 401.
- **`src/lib/sheshi.ts`** — same exported functions/types; bodies call the API.
- **`src/hooks/use-auth.ts`** — same store/shape; backed by token store + `/me`.
- **`src/integrations/supabase/*` + `integrations/lovable/*`** — removed;
  `@supabase/supabase-js` dropped from deps.
- Routes (`auth`, `reset-password`, `profili`, room, thread) swap Supabase auth/realtime
  for the API client + SignalR. UI/markup unchanged.

## 10. Dev & config

`docker-compose.yml` runs Postgres (+ optional Mailpit) for local dev. Backend config
via `appsettings.json` + env: connection string, JWT signing key, OAuth secrets, SMTP,
upload path/limits. `.env.example` documents everything. CORS allows the Vite dev origin.

## 11. Testing

xUnit + `WebApplicationFactory` integration tests against a throwaway Postgres
(Testcontainers or compose DB): auth round-trip; post/vote/report flows; the §6
authorization rules (banned can't post, can't vote on replies, can't self-unban,
mod-only endpoints reject normal users); highlights ranking.

## 12. Out of scope / flagged

- **No data migration** from the existing Supabase project (treated as a fresh DB).
  Copying current rows is a separate add-on if wanted.
- Email delivery needs a chosen SMTP provider (or Mailpit in compose for dev).
- Secret config (OAuth, SMTP, JWT key) is filled into `.env` by the maintainer.

## Execution phasing (high level)

1. Backend scaffold: solution, EF model, migrations, seed, docker Postgres.
2. Auth (Identity, JWT, refresh, OAuth providers).
3. Core API (rooms, messages, votes, reports, highlights) + §6 authorization.
4. SignalR hub + presence.
5. Image upload.
6. Moderation endpoints + dashboard.
7. Frontend rewire (api-client, sheshi.ts, use-auth, routes, SignalR).
8. Tests + docs + cleanup (drop Supabase deps/files).
