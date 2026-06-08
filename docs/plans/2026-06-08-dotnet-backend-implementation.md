# Sheshi .NET Backend — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Supabase backend with a self-owned ASP.NET Core (.NET 10) API + SignalR and rewire the React frontend off the Supabase SDK, porting all features plus image upload, a moderation dashboard, and live presence.

**Architecture:** A single vertical-sliced ASP.NET Core Web API project (`server/Sheshi.Api`) exposes REST endpoints + a SignalR `ChatHub`. EF Core (Npgsql) owns a Postgres schema ported from the existing migrations; ASP.NET Identity (`IdentityUser<Guid>` + roles) replaces Supabase `auth.users`/`user_roles`. JWT access + rotating refresh tokens; OAuth via external providers. Authorization that was Supabase RLS becomes explicit service-layer checks. The React app keeps its UI; only its data/auth/realtime layer is swapped for a REST `api-client` + SignalR.

**Tech Stack:** .NET 10, ASP.NET Core, EF Core 10 + Npgsql, ASP.NET Core Identity, JWT Bearer, SignalR, xUnit + WebApplicationFactory + Testcontainers; React 19 / TanStack Start / `@microsoft/signalr`.

**Reference design:** `docs/plans/2026-06-08-dotnet-backend-design.md`

**Conventions for every task:** work on branch `feat/dotnet-backend`; TDD where a test is specified (write failing test → run → implement → run → commit); commit after each task with the message shown. Backend commands run from `server/`. Frontend commands run from repo root with `bun`.

---

## Phase 0 — Prerequisites & dev infra

### Task 0.1: Verify toolchain

**Step 1:** Run `dotnet --version` → expect `10.*`. If absent, install the .NET 10 SDK before continuing.
**Step 2:** Run `docker --version` and `docker compose version` → expect success (needed for local Postgres + tests).
**Step 3:** Run `bun --version` at repo root → expect success.
No commit (verification only).

### Task 0.2: Local Postgres via docker-compose

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example` (append backend vars)

**Step 1:** Write `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:17
    container_name: sheshi-db
    environment:
      POSTGRES_USER: sheshi
      POSTGRES_PASSWORD: sheshi
      POSTGRES_DB: sheshi
    ports:
      - "5432:5432"
    volumes:
      - sheshi-db-data:/var/lib/postgresql/data
  mailpit:
    image: axllent/mailpit:latest
    container_name: sheshi-mail
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # web UI
volumes:
  sheshi-db-data:
```

**Step 2:** Run `docker compose up -d db` → expect container healthy. Verify: `docker exec sheshi-db pg_isready -U sheshi` → `accepting connections`.

**Step 3:** Create `.env.example` documenting backend config (used by `appsettings` env overrides):

```
# --- Sheshi .NET API ---
ConnectionStrings__Default=Host=localhost;Port=5432;Database=sheshi;Username=sheshi;Password=sheshi
Jwt__Issuer=https://sheshi.local
Jwt__Audience=sheshi-web
Jwt__SigningKey=CHANGE_ME_min_32_byte_random_secret_value_here
Jwt__AccessTokenMinutes=15
Jwt__RefreshTokenDays=30
Cors__AllowedOrigins=http://localhost:3000
Storage__UploadPath=./uploads
Storage__PublicBaseUrl=http://localhost:5080/uploads
Storage__MaxBytes=5242880
Smtp__Host=localhost
Smtp__Port=1025
Smtp__FromEmail=no-reply@sheshi.local
Frontend__BaseUrl=http://localhost:3000
# OAuth (leave blank to disable a provider)
Authentication__Google__ClientId=
Authentication__Google__ClientSecret=
Authentication__Microsoft__ClientId=
Authentication__Microsoft__ClientSecret=
Authentication__Apple__ClientId=
Authentication__Apple__TeamId=
Authentication__Apple__KeyId=
Authentication__Apple__PrivateKey=
# Frontend (Vite)
VITE_API_BASE_URL=http://localhost:5080
```

**Step 4:** Commit.

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add docker-compose (postgres+mailpit) and env template"
```

---

## Phase 1 — Backend scaffold & data model

### Task 1.1: Create solution and projects

**Files:** `server/Sheshi.sln`, `server/Sheshi.Api/`, `server/Sheshi.Api.Tests/`

**Step 1:** Scaffold:

```bash
mkdir -p server && cd server
dotnet new sln -n Sheshi
dotnet new webapi -n Sheshi.Api --use-controllers
dotnet new xunit -n Sheshi.Api.Tests
dotnet sln add Sheshi.Api/Sheshi.Api.csproj Sheshi.Api.Tests/Sheshi.Api.Tests.csproj
dotnet add Sheshi.Api.Tests/Sheshi.Api.Tests.csproj reference Sheshi.Api/Sheshi.Api.csproj
```

**Step 2:** Add packages to `Sheshi.Api`:

```bash
cd Sheshi.Api
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL
dotnet add package Microsoft.EntityFrameworkCore.Design
dotnet add package Microsoft.AspNetCore.Identity.EntityFrameworkCore
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
dotnet add package Microsoft.AspNetCore.Authentication.Google
dotnet add package Microsoft.AspNetCore.Authentication.MicrosoftAccount
dotnet add package AspNet.Security.OAuth.Apple
cd ..
```

**Step 3:** Add packages to `Sheshi.Api.Tests`:

```bash
cd Sheshi.Api.Tests
dotnet add package Microsoft.AspNetCore.Mvc.Testing
dotnet add package Testcontainers.PostgreSql
dotnet add package FluentAssertions
cd ..
```

**Step 4:** Run `dotnet build` → expect success.

**Step 5:** Commit.

```bash
git add server
git commit -m "chore: scaffold .NET solution (Api + Tests) with deps"
```

### Task 1.2: Domain entities

**Files (create under `server/Sheshi.Api/Domain/`):** `ApplicationUser.cs`, `Room.cs`, `Message.cs`, `Vote.cs`, `Report.cs`, `RefreshToken.cs`, `Enums.cs`

```csharp
// Enums.cs
namespace Sheshi.Api.Domain;
public enum ReportReason { Spam, Hate, Doxxing, Violence, Other }
public enum ReportStatus { Open, Resolved, Dismissed }
public static class Roles { public const string User = "user", Moderator = "moderator", Admin = "admin"; }
```

```csharp
// ApplicationUser.cs
using Microsoft.AspNetCore.Identity;
namespace Sheshi.Api.Domain;
public class ApplicationUser : IdentityUser<Guid>
{
    public string? DisplayName { get; set; }
    public string? AvatarUrl { get; set; }
    public DateTimeOffset? BannedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool IsBanned => BannedAt != null;
}
```

```csharp
// Room.cs
namespace Sheshi.Api.Domain;
public class Room
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
```

```csharp
// Message.cs
namespace Sheshi.Api.Domain;
public class Message
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public Guid AuthorId { get; set; }
    public ApplicationUser Author { get; set; } = null!;
    public Guid? ParentId { get; set; }
    public Message? Parent { get; set; }
    public string Body { get; set; } = "";
    public string? ImageUrl { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
```

```csharp
// Vote.cs
namespace Sheshi.Api.Domain;
public class Vote
{
    public Guid MessageId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
```

```csharp
// Report.cs
namespace Sheshi.Api.Domain;
public class Report
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MessageId { get; set; }
    public Guid ReporterId { get; set; }
    public ReportReason Reason { get; set; }
    public string? Note { get; set; }
    public ReportStatus Status { get; set; } = ReportStatus.Open;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
```

```csharp
// RefreshToken.cs
namespace Sheshi.Api.Domain;
public class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";   // SHA-256 of raw token
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool IsActive => RevokedAt == null && ExpiresAt > DateTimeOffset.UtcNow;
}
```

Commit: `git commit -am "feat(api): domain entities"`

### Task 1.3: DbContext + configuration

**Files:** Create `server/Sheshi.Api/Data/AppDbContext.cs`

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Domain;
namespace Sheshi.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<Vote> Votes => Set<Vote>();
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<ApplicationUser>(e => e.HasIndex(u => u.UserName).IsUnique());

        b.Entity<Room>(e => { e.HasIndex(r => r.Slug).IsUnique(); });

        b.Entity<Message>(e =>
        {
            e.Property(m => m.Body).HasMaxLength(2000);
            e.HasOne(m => m.Room).WithMany().HasForeignKey(m => m.RoomId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.Author).WithMany().HasForeignKey(m => m.AuthorId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.Parent).WithMany().HasForeignKey(m => m.ParentId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(m => new { m.RoomId, m.CreatedAt }).HasFilter("\"ParentId\" IS NULL");
            e.HasIndex(m => m.ParentId);
        });

        b.Entity<Vote>(e =>
        {
            e.HasKey(v => new { v.MessageId, v.UserId });
            e.HasOne<Message>().WithMany().HasForeignKey(v => v.MessageId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Report>(e => e.Property(r => r.Note).HasMaxLength(500));

        b.Entity<RefreshToken>(e => { e.HasIndex(t => t.TokenHash); e.HasIndex(t => t.UserId); });
    }
}
```

Commit: `git commit -am "feat(api): AppDbContext + entity config"`

### Task 1.4: First migration + seed rooms

**Step 1:** Add a temporary minimal `Program.cs` registration of the DbContext (will be expanded later). In `Program.cs` after `var builder = WebApplication.CreateBuilder(args);` add:

```csharp
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

Set `ConnectionStrings:Default` in `appsettings.Development.json` (or env per `.env.example`).

**Step 2:** Create migration:

```bash
cd server/Sheshi.Api
dotnet ef migrations add InitialSchema
```

Expected: `Migrations/` folder created. If `dotnet ef` missing: `dotnet tool install --global dotnet-ef`.

**Step 3:** Apply: `dotnet ef database update` → expect tables created. Verify: `docker exec sheshi-db psql -U sheshi -c "\dt"` shows `Rooms`, `Messages`, `AspNetUsers`, etc.

**Step 4:** Create `server/Sheshi.Api/Data/DbSeeder.cs` that, on startup, ensures roles (`user`, `moderator`, `admin`) and the 5 seed rooms exist (idempotent — match by slug):

```csharp
// rooms: sheshi, vjosa-narta, tirana, shkodra, korca with the Albanian names/descriptions
// from supabase/migrations (copy exact strings).
```

Call the seeder from `Program.cs` after `app` is built (scoped service, `await db.Database.MigrateAsync()` then seed).

**Step 5:** Run `dotnet run`, confirm rooms exist: `docker exec sheshi-db psql -U sheshi -c "select slug,name from \"Rooms\";"` → 5 rows.

**Step 6:** Commit. `git add -A && git commit -m "feat(api): initial EF migration + role/room seeder"`

### Task 1.5: Test harness (Testcontainers fixture)

**Files:** Create `server/Sheshi.Api.Tests/ApiFactory.cs` (a `WebApplicationFactory<Program>` that boots a `PostgreSqlContainer`, overrides the connection string, migrates + seeds), and `server/Sheshi.Api.Tests/SmokeTests.cs`.

**Step 1 (failing test):** `SmokeTests`: `GET /api/rooms` returns 200 with 5 rooms.
**Step 2:** Run `dotnet test` → FAIL (endpoint not built yet — this becomes the first green in Phase 3). *Note:* keep this test `[Fact(Skip=...)]`-free but expect it red until Task 3.1; alternatively assert only that the app starts (`GET /health` 200). Prefer a `/health` smoke first:

Add `app.MapGet("/health", () => "ok");` to `Program.cs`; test asserts 200. Run `dotnet test` → PASS.

Make `Program` testable: add `public partial class Program;` at the bottom of `Program.cs`.

**Step 3:** Commit. `git commit -am "test(api): WebApplicationFactory + Testcontainers smoke test"`

---

## Phase 2 — Auth (Identity, JWT, refresh, OAuth)

### Task 2.1: Identity + JWT wiring

**Files:** `Program.cs`; create `server/Sheshi.Api/Auth/JwtOptions.cs`, `Auth/TokenService.cs`.

- Register Identity: `AddIdentityCore<ApplicationUser>()` with `AddRoles<IdentityRole<Guid>>().AddEntityFrameworkStores<AppDbContext>().AddDefaultTokenProviders()`.
- Bind `Jwt` config to `JwtOptions`.
- `TokenService`: `CreateAccessToken(user, roles)` → signed JWT with claims `sub`, `email`, `name` (display), `role` (multiple); `CreateRefreshToken(userId)` → returns raw token + persists `RefreshToken{ TokenHash = SHA256(raw) }`; `ValidateRefresh(raw)`, `Rotate(raw)`, `Revoke(raw)`.
- `AddAuthentication(JwtBearerDefaults).AddJwtBearer(...)` validating issuer/audience/key; **also** add `.AddGoogle/.AddMicrosoftAccount/.AddApple` conditionally (only when ClientId present), each with `SignInScheme = IdentityConstants.ExternalScheme`-free flow — we use a manual external callback (Task 2.4), so configure them under a cookie-less external handler. (Implementation detail: use `AddAuthentication()` default = JwtBearer; add a dedicated cookie scheme `"External"` for the OAuth correlation handshake.)

**TDD:** Unit-test `TokenService.CreateAccessToken` produces a token whose validated claims include the user id and roles. Run → implement → pass → commit `feat(api): JWT token service + identity wiring`.

### Task 2.2: DTOs + register/login endpoints

**Files:** `server/Sheshi.Api/Auth/AuthController.cs`, `Auth/AuthDtos.cs`, `Auth/UserService.cs`.

- `POST /api/auth/register` `{ email, password, displayName? }`: create user (UserName derived like the old trigger: `lower(local-part)+"_"+first4(id)`; ensure uniqueness), set DisplayName (fallback to local-part), assign `user` role. Return access+refresh.
- `POST /api/auth/login` `{ email, password }`: verify via `UserManager.CheckPasswordAsync`; reject if no user/bad password. Return tokens + minimal profile.
- `POST /api/auth/refresh` `{ refreshToken }`: rotate; reject revoked/expired.
- `POST /api/auth/logout` (auth): revoke presented refresh token.

**TDD (integration):** register → login → refresh happy path; login with wrong password → 401; refresh with revoked token → 401. Run → implement → pass → commit `feat(api): register/login/refresh/logout`.

### Task 2.3: Password reset

**Files:** extend `AuthController`; create `server/Sheshi.Api/Email/IEmailSender.cs` + `SmtpEmailSender.cs`.

- `POST /api/auth/forgot-password` `{ email }`: always 200 (don't leak existence); if user exists, generate Identity reset token, email a link to `${Frontend:BaseUrl}/reset-password?token=...&email=...`.
- `POST /api/auth/reset-password` `{ email, token, password }`: `UserManager.ResetPasswordAsync`.

**TDD (integration):** forgot-password returns 200 for unknown email; full reset flow updates password (capture token via a test `IEmailSender` fake). Commit `feat(api): password reset via email`.

### Task 2.4: OAuth external login

**Files:** extend `AuthController` with `GET /api/auth/external/{provider}` (challenge) and `GET /api/auth/external/callback` (handle).

- Challenge: `Results.Challenge(props, [provider])` with `RedirectUri` = callback, using the `"External"` cookie scheme for correlation.
- Callback: read external principal; find-or-create `ApplicationUser` by email; set AvatarUrl/DisplayName from claims on first login; assign `user` role; issue access+refresh; **302 redirect** to `${Frontend:BaseUrl}/auth/callback#access_token=<a>&refresh_token=<r>`.
- Providers registered only if configured; `GET /api/auth/providers` returns the enabled list (so the UI can show/hide buttons).

**Test:** unit-test the find-or-create user service (new email creates user+role; existing email reuses). Full provider round-trip is manual (needs real client secrets) — document in README. Commit `feat(api): OAuth external login (google/microsoft/apple)`.

### Task 2.5: `/me` endpoint

`GET /api/me` (auth) → `{ id, email, username, displayName, avatarUrl, roles, isBanned }`. `PATCH /api/me` `{ displayName }` → updates display name only (≤60 chars), never touches BannedAt/roles.

**TDD:** authed GET returns profile; PATCH changes display name; PATCH cannot set banned/role (no such field accepted). Commit `feat(api): /me profile endpoints`.

---

## Phase 3 — Core API + authorization

### Task 3.1: Rooms

**Files:** `server/Sheshi.Api/Features/Rooms/RoomsController.cs`, DTOs.

- `GET /api/rooms` → ordered by name. `GET /api/rooms/{slug}` → 404 if missing.
- Un-skip the Phase-1 smoke test (`GET /api/rooms` returns the 5 seeded rooms).

**TDD:** list returns 5; get by unknown slug → 404. Commit `feat(api): rooms endpoints`.

### Task 3.2: Message read model + stats projection

**Files:** `server/Sheshi.Api/Features/Messages/MessageService.cs`, `MessageDtos.cs`.

`MessageDto` mirrors the frontend `MessageRow`: `id, room_id, author_id, parent_id, body, image_url, deleted_at, created_at, author{ id, username, display_name, avatar_url }, upvotes, reply_count, voted`. Use snake_case JSON (configure `JsonNamingPolicy.SnakeCaseLower` globally) so the frontend types are unchanged.

`MessageService` methods (each computes upvotes via `Votes` count, reply_count via non-deleted children count, `voted` via the caller id — single batched query like today's `attachMeta`):
- `ListRoomTopLevel(roomId, callerId)` — `parent_id == null`, latest 80, returned oldest→newest.
- `GetById(id, callerId)`.
- `ListReplies(parentId, callerId)` — ascending, ≤200.

**TDD:** seed a room+user+messages+votes via the DbContext; assert upvotes/reply_count/voted are correct and deleted replies are excluded from reply_count. Commit `feat(api): message read model with stats`.

### Task 3.3: Post message (+ authorization)

`POST /api/messages` (auth, multipart) `{ room_id, parent_id?, body, image? }`:
- Reject if caller `IsBanned` → 403 (`is_banned` port).
- Validate body trimmed length 1..2000 → 400 (`TOO_LONG`/`EMPTY` parity).
- If `parent_id` set, it must exist and be top-level (no replies-to-replies beyond one level — match current UI which only threads one level; enforce parent's `ParentId == null`).
- Image handling deferred to Phase 5 (accept body-only now; ignore image field).
- Insert; broadcast deferred to Phase 4.

**TDD:** banned user → 403; empty body → 400; 2001 chars → 400; valid → 201 and row exists. Commit `feat(api): post message with validation + ban check`.

### Task 3.4: Votes (+ authorization)

`PUT /api/messages/{id}/vote` and `DELETE /api/messages/{id}/vote` (auth):
- Reject banned → 403.
- Target must be top-level → 400 (`enforce_vote_on_main` port).
- PUT idempotent (insert if absent); DELETE removes. One vote per (message,user).

**TDD:** vote on reply → 400; banned → 403; double-PUT yields single vote; DELETE removes. Commit `feat(api): vote toggle with main-only + ban checks`.

### Task 3.5: Soft-delete (+ authorization)

`DELETE /api/messages/{id}` (auth): allowed if caller is author **or** in role moderator/admin; sets `DeletedAt`. Else 403.

**TDD:** author deletes own → 200; other normal user → 403; moderator deletes other's → 200. Commit `feat(api): soft-delete with author/mod authorization`.

### Task 3.6: Reports

`POST /api/messages/{id}/report` (auth) `{ reason, note? }`: insert `Report{ Open }`. Note ≤500. Message must exist.

**TDD:** valid report inserts row; unknown message → 404; note >500 → 400. Commit `feat(api): file report`.

### Task 3.7: Highlights (server-side ranking)

`GET /api/highlights?mode=hot|top|replied` (anon, caller optional via token): port `listHighlights` exactly — fetch top-level non-deleted (for hot: all; top/replied: last 24h), enrich stats, score, sort, take 10. Score: `(upvotes + reply_count*2) / max(ageHours,0.5)^1.3`.

**TDD:** given crafted timestamps/votes, hot/top/replied return the expected order and length ≤10. Commit `feat(api): highlights ranking endpoint`.

---

## Phase 4 — SignalR realtime + presence

### Task 4.1: ChatHub + broadcasts

**Files:** `server/Sheshi.Api/Realtime/ChatHub.cs`; inject `IHubContext<ChatHub>` into message/vote services.

- Hub methods: `JoinRoom(roomId)`, `LeaveRoom(roomId)`, `JoinThread(messageId)`, `LeaveThread(messageId)` → `Groups.Add/RemoveToGroupAsync` with names `room:{id}` / `thread:{id}`.
- After post/delete/vote, services call `hub.Clients.Group("room:{roomId}").SendAsync("changed")` (and `thread:{parentId}` for replies/their votes). The client just re-fetches (mirrors today's debounced reload), so payload can be a bare signal.
- Map hub: `app.MapHub<ChatHub>("/hub")`. Allow JWT via query string for websockets (`OnMessageReceived` reads `access_token`).

**TDD:** integration test connects a `HubConnection`, joins `room:{id}`, posts a message via REST, and asserts a `changed` signal arrives. Commit `feat(api): SignalR ChatHub + change broadcasts`.

### Task 4.2: Presence counts

- In-memory presence tracker (singleton, concurrent dict `roomId -> connectionIds set`) updated on `JoinRoom`/`LeaveRoom`/`OnDisconnectedAsync`.
- On change, broadcast `presence` with `{ roomId, count }` to `room:{id}`, and expose `GET /api/rooms/presence` returning all current counts (for initial sidebar render).

**TDD:** two hub connections join a room → count 2; one disconnects → count 1. Commit `feat(api): live presence counts per room`.

---

## Phase 5 — Image upload

### Task 5.1: Storage abstraction

**Files:** `server/Sheshi.Api/Storage/IImageStorage.cs`, `Storage/LocalFileImageStorage.cs`, bind `Storage` options.

`IImageStorage.SaveAsync(Stream, contentType) -> publicUrl`. Local impl: validate content type ∈ {image/jpeg,png,webp} and size ≤ `Storage:MaxBytes`; write `{guid}.{ext}` under `Storage:UploadPath`; return `${Storage:PublicBaseUrl}/{file}`. Serve the folder via `UseStaticFiles` mapped at `/uploads`.

**TDD:** saving a small png returns a URL and the file exists; oversize → throws; wrong type → throws. Commit `feat(api): local image storage behind IImageStorage`.

### Task 5.2: Wire image into post message

Extend Task 3.3 handler: if `image` present, `SaveAsync` → set `Message.ImageUrl`. Enforce size/type errors as 400.

**TDD:** posting multipart with a png sets image_url; oversize → 400. Commit `feat(api): attach image to messages`.

---

## Phase 6 — Moderation endpoints

### Task 6.1: Mod report queue

**Files:** `server/Sheshi.Api/Features/Moderation/ModerationController.cs` (`[Authorize(Roles="moderator,admin")]`).

- `GET /api/mod/reports?status=open` → reports joined with message body/author + reporter.
- `POST /api/mod/reports/{id}/resolve` / `dismiss` → set status.

**TDD:** normal user → 403; moderator lists & resolves. Commit `feat(api): moderation report queue`.

### Task 6.2: Ban / unban

- `POST /api/mod/users/{id}/ban` → set `BannedAt = now`; `POST …/unban` → null. Mod/admin only.

**TDD:** moderator bans a user → that user's post now 403; unban restores. Commit `feat(api): ban/unban users`.

### Task 6.3: Role management (admin only)

- `POST /api/mod/users/{id}/roles` `{ role: "moderator", grant: true|false }` `[Authorize(Roles="admin")]` → add/remove Identity role.
- `GET /api/mod/users?query=` search by username/email for the dashboard.

**TDD:** moderator calling roles endpoint → 403; admin grants moderator → target gains access to `/api/mod/reports`. Commit `feat(api): admin role management`.

---

## Phase 7 — Frontend rewire

> UI/markup stays; only data/auth/realtime sources change. Add `VITE_API_BASE_URL`. Add deps: `bun add @microsoft/signalr`. Remove `@supabase/supabase-js` and `@lovable.dev/*` at the end (Task 7.8).

### Task 7.1: API client + token store

**Files:** Create `src/lib/api-client.ts`, `src/lib/token-store.ts`.

- `token-store`: get/set/clear `{ accessToken, refreshToken }` in `localStorage`; pub/sub like `use-auth`.
- `api-client`: `api(path, opts)` → adds `Authorization: Bearer <access>`; on 401 once, calls `/api/auth/refresh`, stores new tokens, retries; helpers `apiJson`, `apiForm`. Base URL from `import.meta.env.VITE_API_BASE_URL`.

Commit `feat(web): API client + token store`.

### Task 7.2: Rewrite `use-auth`

Keep the exact exported shape (`useAuth()` → `{ session?, user, isReady }`, `getAuthSnapshot()`). Back it with token-store + a `/api/me` fetch. `user` carries `{ id, email }` (+ roles for the dashboard). `isReady` true after the initial `/me` (or no-token) resolves.

Commit `feat(web): use-auth backed by .NET API`.

### Task 7.3: Rewrite `src/lib/sheshi.ts`

Same exported functions/types; bodies call `api-client`:
- `listRooms/getRoomBySlug` → `/api/rooms*`
- `listMessages/getMessage/listReplies` → `/api/...` (server already returns enriched DTOs, so `attachMeta` is deleted).
- `postMessage` → `POST /api/messages` (FormData when image; else JSON). Keep `EMPTY/TOO_LONG/UNAUTH` error semantics by mapping API 400/401/403.
- `toggleVote` → `PUT/DELETE /api/messages/{id}/vote`.
- `softDeleteMessage` → `DELETE /api/messages/{id}`.
- `submitReport` → `POST /api/messages/{id}/report`.
- `listHighlights` → `GET /api/highlights?mode=` (server-ranked; drop client sort).

Commit `feat(web): sheshi data layer calls .NET API`.

### Task 7.4: Auth routes

- `auth.tsx`: email/password → `/api/auth/register|login`; Google button → redirect to `${API}/api/auth/external/google`; show only providers from `/api/auth/providers`; forgot → `/api/auth/forgot-password`.
- New `src/routes/auth.callback.tsx`: parse `#access_token&refresh_token`, store, redirect to `/r/sheshi`.
- `reset-password.tsx`: read `?token&email`, `POST /api/auth/reset-password`.
- `profili.tsx`: load `/api/me`, save display name via `PATCH /api/me`, sign-out clears tokens (+ `POST /api/auth/logout`).

Commit `feat(web): auth/reset/profile routes on .NET API`.

### Task 7.5: SignalR in room & thread routes

Create `src/lib/realtime.ts` (singleton `HubConnection` to `${API}/hub`, with `accessTokenFactory`). In `r.$slug.tsx` and `r.$slug.t.$messageId.tsx`, replace `supabase.channel(...)` with `JoinRoom/JoinThread` + an `on("changed", scheduleReload)` handler; keep the debounce. Leave groups on unmount.

Commit `feat(web): realtime via SignalR`.

### Task 7.6: Presence in sidebar

`src/components/AppShell.tsx`: drop hardcoded `ROOM_META` counts; subscribe to `presence` events + seed from `GET /api/rooms/presence`; render live per-room counts (keep the "URGJENT" styling option but drive it from real data or remove).

Commit `feat(web): live presence counts in sidebar`.

### Task 7.7: Image upload in Composer + moderation route

- `Composer.tsx`: add an image picker (button + hidden file input), preview thumbnail, clear control; pass the `File` to `postMessage`.
- New `src/routes/moderim.tsx`: gated on `roles` from `/me` (redirect non-mods); tabs Reports / Users / Roles calling `/api/mod/*`. Reuse existing shadcn `ui` components.
- Add `/moderim` link in `AppShell` header when `user` has moderator/admin.

Commit `feat(web): image upload + moderation dashboard`.

### Task 7.8: Remove Supabase

Delete `src/integrations/supabase/*`, `src/integrations/lovable/*`, `src/lib/api/example.functions.ts` (if unused), the `attachSupabaseAuth` wiring in `src/start.ts`. `bun remove @supabase/supabase-js @lovable.dev/cloud-auth-js`. Delete `supabase/` dir and Supabase `.env` keys. Update `sitemap` BASE_URL if needed. Run `bun run build` → expect success (no Supabase imports remain: `grep -r supabase src` empty).

Commit `chore(web): remove Supabase/Lovable integration`.

---

## Phase 8 — Integration, docs, polish

### Task 8.1: End-to-end manual run

`docker compose up -d`; `dotnet run` (API on :5080); `bun run dev` (web on :3000). Use the **run** skill to verify: register → post → upvote → reply → highlights update → report → (as seeded admin) moderate → image upload renders → presence count changes across two tabs.

### Task 8.2: Seed an admin + README

Add a `dotnet run -- seed-admin <email>` startup arg (or env `Seed__AdminEmail`) that grants `admin` to a user. Write `server/README.md`: prerequisites, `docker compose up`, migrations, `dotnet run`, OAuth/SMTP config, running tests. Update root README to point frontend at the API.

Commit `docs: backend README + admin seeding`.

### Task 8.3: Full test pass

`cd server && dotnet test` → all green. `bun run build` → success. Fix any gaps. Commit `test: full backend suite green`.

### Task 8.4: Finish the branch

Use superpowers:finishing-a-development-branch to decide merge/PR. Branch: `feat/dotnet-backend`.

---

## Notes / risks

- **Apple OAuth** needs a paid Apple Developer account + a key-signed client secret; ship Google first, Apple when credentials exist (provider is config-gated).
- **Snake_case JSON** globally keeps frontend `MessageRow`/`Room`/`Profile` types unchanged — verify the casing policy covers nested `author`.
- **No data migration** from Supabase (fresh DB). If current rows are wanted, add a one-off CSV/`pg_dump` import task — out of scope here.
- Email in dev goes to **Mailpit** (`http://localhost:8025`); production needs a real SMTP provider.
