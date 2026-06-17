# Proposals & Voting (Kërkesat e Propozuara / Miratuara) — design + plan

**Date:** 2026-06-18
**Status:** in progress

## Goal

Add the civic core of Sheshi from the platform spec: citizens submit **kërkesa** (demands/proposals),
the community votes **PRO / KUNDËR**, and a proposal that wins a supermajority with sufficient turnout is
promoted to the approved list. Two new screens — **Kërkesat e Propozuara** (open for voting) and
**Kërkesat e Miratuara** (approved) — sit alongside the existing live chat (Dhomat). The live-chat screen
already exists; this slice is *only* proposals + voting.

## Scope decisions (interviewed)

1. **Global, not per-room.** Proposals are platform-wide civic lists filtered by category, independent of
   chat Rooms. They get their own realtime channel `proposals:feed`. (The spec frames Propozuara/Miratuara
   as nation-wide lists, separate from room chat.)
2. **One vote per user**, `PRO = +1 / KUNDËR = −1 / un-vote = 0`, enforced at the DB by a composite PK
   `(ProposalId, UserId)` and an atomic upsert — a direct clone of the proven `Domain/Vote.cs` +
   `MessageService` vote path (which already survived the concurrent-vote race fix).
3. **Promotion rule — supermajority + quorum.** A `Proposed` proposal becomes `Approved` when
   `PRO / (PRO + KUNDËR) ≥ MinApprovalRatio` **and** `PRO + KUNDËR ≥ MinQuorum`. Both are config constants
   (`ProposalApproval:MinRatio` default `0.60`, `ProposalApproval:MinQuorum` default `100`) so they tune
   without a redeploy. The quorum prevents a 3–0 proposal from flipping on trivial turnout.
4. **Vote privacy.** Aggregate-only broadcasts: `proposal_vote_changed` carries `{ proposal_id, score,
   pro, kunder }` and never who voted; the voter's own state syncs via a private
   `my_proposal_vote_changed` to their connections — mirroring the deliberate `vote_changed` /
   `my_vote_changed` split.
5. **Moderator-approved queue (visibility gate).** A new proposal starts `Pending` and is hidden from the
   public list until a moderator publishes it. A light per-user submission rate limit (`proposals` policy)
   is kept as defense-in-depth so the queue itself cannot be flooded.
6. **Moderation via the existing slice.** Publish / reject / close are audit-logged through
   `ModerationActionLogger.LogAsync` with new `proposal_*` action types, exactly like every other
   privileged action in the codebase.
7. **Categories are a fixed C# enum** — `ProposalCategory { Ligje, Shendetesi, Arsim, Zhvillim }` — stored
   as a constrained column and exposed as snake_case strings, mirroring how `ModerationCategory` /
   `ReportReason` are modelled. No seeded table (categories are spec-fixed, not admin-editable).

## Lifecycle

Two distinct "approvals" — named carefully to avoid confusion:

```
submit ─▶ Pending ──mod PUBLISH──▶ Proposed ──vote ≥ratio & ≥quorum──▶ Approved (Miratuara)
            │                          │
       mod REJECT                 withdraw (author) / close (mod)  → DeletedAt set (soft-delete)
            ▼
         Rejected
```

- **Pending** — submitted, hidden, awaiting moderator review (only the author + moderators can see it).
- **Proposed** — published by a moderator, visible in *Kërkesat e Propozuara*, open for voting.
- **Approved** — crossed the vote threshold; appears in *Kërkesat e Miratuara*; `ApprovedAt` stamped; the
  transition fires `proposal_approved` and is **one-way** (we never demote on a later vote swing — an
  approved demand is a settled civic outcome).
- **Rejected** — moderator rejected it from the queue.
- **withdraw / close** — soft-delete via `DeletedAt` (orthogonal to status); every read filters
  `DeletedAt IS NULL`. Author may withdraw while `Pending`/`Proposed`; moderators may close anytime.
  Author may edit title/body only while `Pending` **or** `Proposed` with **zero votes cast** (no
  bait-and-switch after people vote).

## Data model

Two new entities under `/Domain`, mirroring existing conventions (Guid PK defaulted at construction,
`DateTimeOffset` timestamps, soft-delete, file-header trust-boundary doc-block).

**`Proposal`**

| field        | type                 | notes                                                            |
|--------------|----------------------|------------------------------------------------------------------|
| `Id`         | `Guid`               | `= Guid.NewGuid()`                                               |
| `Title`      | `string`             | ≤ 160 chars (validated in controller)                            |
| `Body`       | `string`             | ≤ 8 000 chars                                                    |
| `Category`   | `ProposalCategory`   | stored as string via `HasConversion<string>()`, check constraint |
| `Status`     | `ProposalStatus`     | stored as string, default `Pending`, check constraint           |
| `AuthorId`   | `Guid`               | FK → `ApplicationUser`, `OnDelete Restrict` (audit actor)       |
| `CreatedAt`  | `DateTimeOffset`     | `= UtcNow`                                                       |
| `PublishedAt`| `DateTimeOffset?`    | set on moderator publish                                         |
| `ApprovedAt` | `DateTimeOffset?`    | set on vote promotion (one-way)                                  |
| `DeletedAt`  | `DateTimeOffset?`    | soft-delete                                                      |

`Score` / `Pro` / `Kunder` are **not** stored — they are aggregated (`SUM`/`COUNT`) at read time
exactly like `Message.Score`, keeping with the codebase's no-denormalization convention. `Status` and
`ApprovedAt` *are* stored, because the promotion transition is a persisted, one-way side-effect.
Indexes: `(Status, Category)` for the filtered feed; `(CreatedAt desc)`.

**`ProposalVote`** — clone of `Vote`:

| field        | type     | notes                                            |
|--------------|----------|--------------------------------------------------|
| `ProposalId` | `Guid`   | composite PK part, FK → `Proposal`, Cascade      |
| `UserId`     | `Guid`   | composite PK part, FK → `ApplicationUser`, Cascade|
| `Value`      | `short`  | check constraint `Value IN (-1, 1)`              |
| `CreatedAt`  | `DateTimeOffset` | `= UtcNow`                               |

`HasKey(v => new { v.ProposalId, v.UserId })`. Migration: `..._AddProposalsAndVotes` via
`dotnet ef migrations add` (never hand-edit the snapshot).

## API (`Features/Proposals`, `[Route("api/proposals")]`)

Three files mirroring `Features/Rooms`: `ProposalsController.cs`, `ProposalDtos.cs`, `ProposalService.cs`.

| verb + route                          | auth                         | rate-limit  | purpose                                                |
|---------------------------------------|------------------------------|-------------|--------------------------------------------------------|
| `GET  /api/proposals`                 | anon                         | `reads`     | list `Proposed`/`Approved` by `?status=&category=`     |
| `GET  /api/proposals/{id}`            | anon                         | `reads`     | one proposal + caller's `my_vote`                      |
| `POST /api/proposals`                 | `[Authorize]` + ban-gate     | `proposals` | submit → `Pending`                                     |
| `PATCH /api/proposals/{id}`           | `[Authorize]` author-only    | `writes`    | edit title/body while editable (Pending/Proposed,0 votes)|
| `DELETE /api/proposals/{id}`          | `[Authorize]` author-only    | `writes`    | withdraw (soft-delete)                                  |
| `PUT  /api/proposals/{id}/vote`       | `[Authorize]` + ban-gate     | `writes`    | upsert PRO/KUNDËR/un-vote; may trigger promotion        |
| `GET  /api/proposals/queue`           | `Roles.ModeratorOrAdmin`     | `reads`     | the `Pending` review queue (`[FromQuery]` filters)      |
| `PUT  /api/proposals/{id}/review`     | `Roles.ModeratorOrAdmin`     | `moderation`| publish / reject (body `{ action }`), audit-logged      |
| `PUT  /api/proposals/{id}/close`      | `Roles.ModeratorOrAdmin`     | `moderation`| soft-delete a published proposal, audit-logged          |

- Validation lives in the **controller** (null/length/enum/range → `BadRequest(new { error = "CODE" })`);
  the service never throws for user error. Statuses/categories bind via `[FromQuery(Name="…")]`.
- `ProposalService.VoteAsync` does the atomic upsert (raw `ON CONFLICT … DO UPDATE` via
  `ExecuteSqlAsync`), recomputes `Score/ProVotes/KunderVotes` from DB truth, evaluates the promotion rule
  against that truth, and — on first crossing — flips `Status = Approved`, stamps `ApprovedAt`, returns a
  flag so the controller fires `ProposalApprovedAsync`. Promotion is decided on **DB truth**, never the
  caller's optimistic value (out-of-order votes must not prematurely flip status).

## Realtime

- `RealtimeNotifier` gains `ProposalCreatedAsync` (on publish, not submit), `ProposalVoteChangedAsync`
  (aggregate only), `MyProposalVoteChangedAsync` (per-user), `ProposalApprovedAsync`.
- `GroupNames.Proposals()` → `"proposals:feed"` (a **single** shared group — not per-category — to stay
  under the 10-groups-per-connection cap in `HubInvocationThrottleFilter`).
- `ChatHub` gains `JoinProposals` / `LeaveProposals`.
- Proposal votes route through a **`ProposalVoteCoalescer`** cloned from `VoteBroadcastCoalescer` (250 ms
  window, leading edge + DB-truth trailing flush). Raw per-vote broadcast is O(votes × viewers) and would
  flood a hot proposal — this is the same amplification the messages path already solved.
- Frontend: both routes `JoinProposals` on mount, subscribe to the three events, patch the React Query
  cache (single source of truth — clone `applyVoteToCaches` as `applyProposalVoteToCaches`, patching every
  cached proposal query), and wire `useRealtimeResync` to invalidate `['proposals']` on reconnect /
  tab-foreground and re-`JoinProposals` after auto-reconnect (group membership is not persisted).

## Frontend

- Routes: `src/routes/kerkesat-e-propozuara.tsx` (list + category segmented filter + PRO/KUNDËR voting +
  submit dialog), `src/routes/kerkesat-e-miratuara.tsx` (approved list, category filter, read-only).
- Hook: `src/hooks/use-proposals.ts` → `useQuery(['proposals', filters], listProposals, { staleTime })`.
- Components: `ProposalCard.tsx` (models `MessageCard`, `asThreadLink={false}`),
  `ProposalVoteControl.tsx` (models `VoteControl` — overlay model, optimistic write, rollback on error).
- `src/lib/sheshi.ts`: `Proposal` / `ProposalVote` / `ProposalCategory` / `ProposalStatus` types +
  `listProposals / getProposal / submitProposal / editProposal / withdrawProposal / voteProposal /
  reviewProposal` via `apiJson<T>`.
- `src/i18n/sq.ts`: a flat `proposals` section (Albanian copy: `propozuara`, `miratuara`, `pro`, `kunder`,
  `category.{ligje,shendetesi,arsim,zhvillim}`, `submit`, `empty`, `pending`, error codes).
- `src/components/AppShell.tsx`: add the two routes to `dockTabs` + active-pathname checks (mind mobile
  dock width — the dock already carries several tabs).

## Tests

- **Backend** (`Sheshi.Api.Tests/ProposalApiTests.cs`, Testcontainers Postgres via `ApiFactory`,
  FluentAssertions): submit→Pending hidden from public list; moderator publish→visible; reject→hidden;
  vote PRO/KUNDËR updates score; **un-vote**; promotion at ratio+quorum boundary (and *not* below quorum);
  approved is one-way; author edit blocked once a vote exists; withdraw soft-deletes; auth matrix
  (401 anon write, 403 banned, 403 non-moderator on queue/review); **concurrent-vote idempotency** via
  `Task.WhenAll` (composite PK → no 500). Realtime: a `HubConnectionBuilder` test asserting
  `proposal_approved` fires on the crossing vote.
- **Frontend** (`ProposalVoteControl.test.tsx`, Vitest, `vi.hoisted` fakes, `makeProposal()` factory,
  `QueryClientProvider` helper): optimistic PRO/KUNDËR/un-vote, rollback on rejected request, echo does
  not clobber the caller's own vote.
- Every later bug fix on this feature ships a `// Regression:` test.

## Risks / guardrails (carried from the codebase map)

- Distinct `ProposalVote` entity — do **not** overload `Vote` (its PK is `MessageId,UserId`).
- Atomic upsert is mandatory (non-atomic read-then-insert races into a PK-violation 500 — already fixed
  once for messages).
- Promotion check against DB truth after the upsert, inside the service.
- Every read filters `DeletedAt IS NULL`.
- Single `proposals:feed` group (hub group cap).
- Migration must be committed; prod applies via `migrate.sh --migrate-only` before services start.

## Plan (atomic commits, on `feat/proposals-voting`)

1. **docs** — this file.
2. **feat(server): Proposal + ProposalVote domain + enums** — entities, `ProposalStatus`,
   `ProposalCategory`, `proposal_*` moderation action types.
3. **feat(server): AppDbContext config + migration** — DbSets, model config, `..._AddProposalsAndVotes`.
4. **feat(server): ProposalService + DTOs** — list/get/create/edit/withdraw/vote(upsert+promotion)/review.
5. **feat(server): ProposalsController + Program wiring** — endpoints, DI, `proposals` rate-limit policy.
6. **feat(server): proposal realtime** — notifier events, group, hub join, `ProposalVoteCoalescer`.
7. **test(server): ProposalApiTests** — lifecycle, auth matrix, promotion boundary, concurrent-vote.
8. **feat(web): data layer** — `sheshi.ts` types/fns, `use-proposals` hook, i18n.
9. **feat(web): UI** — `ProposalCard`, `ProposalVoteControl` (+ test), the two routes, realtime wiring.
10. **feat(web): nav** — AppShell dock tabs.
11. **docs(sync): README/architecture** — reflect the new feature.
