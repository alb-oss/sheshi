# ADR: Structured logging + error tracking (server)

Date: 2026-06-18 · Status: accepted · Scope: `server/Sheshi.Api` (the hosted product; the mobile app is **not** part of the hosting and is out of scope).

## Context
Production observability was the weakest spot in the readiness review: default `Microsoft.Extensions.Logging`, no request correlation, no error tracking. For incident response on the single-VM Hetzner deploy we need (a) machine-parseable logs with a request/trace id, and (b) exceptions captured with context off-box.

## Decision
**Logging — Serilog** (`Serilog.AspNetCore`). Structured **JSON to stdout** (`RenderedCompactJsonFormatter`) — Docker/journald already capture stdout, so no extra sink/agent. `Enrich.FromLogContext()` + ASP.NET activity tracking gives each event a `TraceId`/`SpanId`; `UseSerilogRequestLogging()` emits one structured completion line per request (method, path, status, elapsed, traceId). Levels via config: app=Information, `Microsoft`/`System`=Warning to cut noise.

**Error tracking — Sentry** (`Sentry.AspNetCore`), **DSN-gated**. Wired only when `Sentry:Dsn` (resolved via the existing secret-file mechanism, so `Sentry__DsnFile` works) is non-empty — so dev/test/unconfigured prod stay fully offline (no events, no dependency on an external service to boot). Captures unhandled exceptions with request context; `SendDefaultPii = false`; `Environment` from the host env; `Release` from `Sentry:Release` (the deploy SHA) when set. The existing global exception handler (`{ error = "INTERNAL_ERROR" }`, no stack traces to clients) is unchanged — Sentry captures *before* the response is sanitized.

Alternatives considered: OpenTelemetry/Seq (more infra to run on a single VM) — rejected for now; Sentry is the lowest-friction "error tracking" and is opt-in. Built-in JSON console logger — rejected: Serilog gives request logging + enrichment for free.

## Consequences
- Logs are JSON with correlation ids → greppable/queryable; one line per request.
- Exceptions surface in Sentry (once a DSN is set) with env + release; nothing sent until configured.
- **No secrets/PII logged**: request logging records method/path/status only (no bodies/headers); the refresh token lives in an HttpOnly cookie / OAuth fragment (never reaches server logs); `SendDefaultPii = false`.
- New config: `Serilog` section + `Sentry:Dsn` (empty default) in appsettings; `Sentry__Dsn` / `Sentry__Release` placeholders in the prod env + sops templates.
- Verified: `dotnet build` + the full xUnit/Testcontainers suite (boot path runs through the new pipeline) stay green; a focused test proves boot with and without a DSN and that the structured error response is preserved.
