# ADR: Security-review hardening (server batch)

Date: 2026-06-18 · Status: accepted · Branch: `chore/testing-hardening-security`

## Context

A repository-wide Codex security scan (commit `95cd07c`) produced 10 findings — **0 critical, 1 high, 4 medium, 5 low**. No privilege-escalation-to-admin, SQLi, XSS, path-traversal, or canonical-deploy secret leak (prior hardening held). This ADR covers the **7 server-side findings** that are surgical and low-risk; the **mobile cluster (#2 web/mobile auth-contract split, #4 Expo/RN dep upgrades, #5 AsyncStorage→SecureStore)** is deferred to a separate effort because it spans the client contract + a disruptive dependency upgrade.

## Decisions

**1 (HIGH) — Soft-deleted messages leak `Body`/`ImageUrl`/`VideoUrl` on public reads.**
Decision: **Tombstone at the DTO boundary.** Wherever a `MessageDto` is built, if `DeletedAt != null` → `Body = ""`, `ImageUrl = null`, `VideoUrl = null` (keep the row + `DeletedAt`). Alternatives considered: *exclude deleted rows from reads* (rejected — orphans replies, breaks reply counts, and the realtime `message_deleted` event already expects a tombstone). Consequence: deleted content is unrecoverable via the API; thread structure/counts and the existing `[deleted]` UI are unchanged.

**3 (MED) — Moderators can ban/unban admins.** `Ban`/`Unban` inherit the class-level `ModeratorOrAdmin` policy with no target check.
Decision: **Admins only for privileged targets, + no self-ban.** A target holding `admin` or `moderator` role may only be banned/unbanned by an `admin`; an actor cannot ban themselves. Moderators retain ban over regular users. Role grants stay admin-only (unchanged). Consequence: the moderation control plane can't be turned on its own admins by a lower-trust moderator.

**6 (LOW) — Incomplete ban enforcement.** Post/vote check `IsBanned`; report, `PATCH /me`, and refresh-rotation don't.
Decision: **Centralize the ban gate** on all authenticated writes (report, profile update) and re-check `IsBanned` in `RotateRefreshTokenAsync` (reject + revoke if banned). Consequence: a banned user with a pre-ban token can't act, even on the non-revoking paths.

**7 (LOW) — `VoteBroadcastCoalescer` leaks leading-edge entries.** A leading-edge send creates a `_byMessage` entry but schedules no cleanup; a single vote on a never-revisited message leaks forever.
Decision: **Arm a cleanup timer on the leading edge** so the entry is removed after `Interval` if no trailing flush supersedes it. Add an internal `PendingCount` test seam. Consequence: bounded memory regardless of vote-spread.

**8 (LOW) — Image dimension/pixel checks run after full `Image.Load`.** A decompression bomb forces decode before rejection.
Decision: **`Image.Identify` (metadata-only) first** to reject oversized dimensions/pixels before the full decode + re-encode; keep the existing byte cap. Consequence: cheap rejection of compression bombs on the authenticated upload path.

**9 (LOW) — Production can boot with the repo-known dev JWT signing key** if launched outside the canonical Hetzner path (which uses a Docker secret + preflight).
Decision: **Fail startup** when `Environment != Development` and the configured `Jwt:SigningKey` equals the known appsettings dev placeholder. Consequence: fail-closed against a forgeable-token misconfig; canonical deploy is unaffected.

**10 (LOW) — `reset-password` is an account-existence oracle** (generic error for missing users, Identity error descriptions for existing-user-invalid-token).
Decision: **One generic response shape** for all reset failures (missing user / invalid token / weak password); log details server-side only. Consequence: closes the enumeration discrepancy; matches the already-generic `forgot-password`.

## Cross-cutting

- Every fix ships a **regression test** reproducing the original weakness (assert the security-relevant fragment).
- Behavior-preserving for legitimate flows; verified via `dotnet build` + the full xUnit/Testcontainers suite.
- One PR; ADR committed before the implementation commits.
