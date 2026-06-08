# Sheshi API

ASP.NET Core Web API + SignalR backend for Sheshi.

## Prerequisites

- .NET 10 SDK
- Docker Desktop or a compatible Docker engine
- Node/npm for the frontend

## Local Services

From the repository root:

```bash
docker compose up -d
```

This starts:

- Postgres on `localhost:55432`
- Mailpit SMTP on `localhost:1025`
- Mailpit UI on `http://localhost:8025`

## Configuration

Copy the root `.env.example` to your local environment manager or shell exports. The
important local defaults are:

```bash
ConnectionStrings__Default=Host=localhost;Port=55432;Database=sheshi;Username=sheshi;Password=sheshi
Jwt__SigningKey=CHANGE_ME_min_32_byte_random_secret_value_here
Frontend__BaseUrl=http://localhost:3000
VITE_API_BASE_URL=http://localhost:5080
```

OAuth providers are enabled only when their client credentials are present.

## First Admin

Set these before first startup, or set them later to promote an existing account by
email:

```bash
SeedAdmin__Email=admin@example.com
SeedAdmin__Password=AdminPassword123!
SeedAdmin__DisplayName=Sheshi Admin
```

When both email and password are set, startup creates that account if needed and
ensures it has `user` and `admin` roles. Leave them blank in production unless this
bootstrap behavior is intentional.

## Run

From the repository root:

```bash
dotnet run --project server/Sheshi.Api
```

The API listens on `http://localhost:5080`. Startup applies EF migrations and seeds
roles plus the default rooms.

Run the frontend separately:

```bash
npm run dev
```

## Test

```bash
cd server
dotnet test
```

The integration tests use Testcontainers Postgres and do not require the compose DB.

## Useful Endpoints

- `GET /health`
- `GET /api/rooms`
- `GET /api/highlights?mode=hot`
- `GET /api/rooms/presence`
- `GET /api/auth/providers`
- `GET /hub` through SignalR clients
