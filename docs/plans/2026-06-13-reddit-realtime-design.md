# Sheshi — Fast-paced Reddit + super-realtime — Spec & Plan

**Branch:** `feat/dotnet-backend` · **Date:** 2026-06-13 · builds on the completed .NET rewrite
(see `docs/sheshi-dotnet-backend-master-spec.md`).

## Where we actually are (read from current code, not assumed)

The rewrite is already most of the way to "Reddit" — confirmed in source:

- **Open posting ✅** — `MessagesController.PostMessage` requires only `[Authorize]` + not-banned.
  **Any signed-in user posts top-level threads** (no admin gate). *You were right.*
- **Reddit-style routes ✅** — `/` directory, `/dhoma/:slug` room feeds, `/tema/:id` nested
  threads, `/fokus`.
- **Cursor pagination ✅** — `ListRoomMessagesAsync(roomId, …, limit, cursor)` → `CursorPageDto`
  (infinite-scroll-ready), same for replies.
- **Votes (upvote toggle), soft-delete, reports, moderation dashboard, image upload, rate
  limiting ✅.**
- **Realtime ⚠️ COARSE** — `RealtimeNotifier.MessageChangedAsync` sends a bare `"changed"`
  signal to `room:{id}`/`thread:{root}`; the client *refetches* (debounced). Works, but not
  "fast-paced" — every change is a round-trip and a full reload.
- **"Në Fokus" ⚠️ GLOBAL only** — `GET /api/highlights?mode=hot|top|replied` ranks across
  **all** rooms (no room filter), returns top 10. Not per-room.

So the two real gaps are **(1) per-room Hot** and **(2) make realtime push deltas, not "refetch".**

## Goals

Make it *feel* like a fast-paced Reddit: instant optimistic interactions, live feed/thread
updates with no reload, per-room + global Hot, sort tabs, infinite scroll.

## Spec

### 1. Realtime v2 — delta push (the headline)
Replace the single `"changed"` with **typed delta events** to the same groups, carrying the
data so the client mutates its local cache instead of refetching:

| Event | Payload | Client action |
|---|---|---|
| `message:new` | `{ message: MessageDto, roomId, parentId, rootId }` | insert into the room feed (New/Hot) + thread tree, live |
| `message:deleted` | `{ id, roomId, rootId }` | mark the node deleted in place |
| `vote:changed` | `{ messageId, upvotes, roomId, rootId }` | update the count live |
| `presence` (exists) | per-room viewer count | already wired |

- **Server:** `RealtimeNotifier` gains `MessageCreatedAsync(MessageDto, …)`,
  `VoteChangedAsync(messageId, upvotes, …)`, `MessageDeletedAsync(…)`. The controllers already
  hold the message/DTO — pass it through instead of a bare signal. (Broadcast the enriched DTO
  *without* caller-specific `voted`; each client derives its own `voted`.)
- **Client (`src/lib/realtime.ts`):** typed `on(event, handler)`; room/feed/thread routes apply
  deltas to the **TanStack Query cache** (`setQueryData`) — no refetch.
- **Optimistic voting:** on click, bump the local count + `voted` immediately, fire PUT/DELETE,
  reconcile when the `vote:changed` echo arrives (idempotent). Feels instant.
- **Live "new posts":** on `message:new` in a room you're viewing, insert at top of New (and into
  Hot if it ranks) — or show a subtle "N new posts" pill for Hot to avoid reflow churn.

### 2. Per-room + global Hot ("Në Fokus" per room)
- `GET /api/highlights?mode=hot|top|replied&room_id={guid?}` — optional `room_id` filters the
  candidate query to that room; omitted = global (today's behavior, the front-page feed).
- **`/dhoma/:slug`** shows that room's Hot in its rail/header; **`/` (front page)** = the global
  Hot feed (Reddit front page).
- Ranking unchanged (`(up + replies·2)/ageH^1.3`); just scoped.

### 3. Reddit feed UX
- **Sort tabs** Hot / New / Top on the room feed and front page (Hot/Top → `/highlights`; New →
  the cursor-paginated `messages` endpoint).
- **Infinite scroll** wired to the existing cursor API (`limit`+`cursor`) via TanStack Query
  `useInfiniteQuery`.
- **Optimistic everything** — post, vote, delete reflect instantly, reconciled by the realtime echo.

### 4. (Optional, phase-later) Downvotes
Reddit has up+down; today `Vote` is upvote-only (a "like"). Adding downvotes = a `Value`
(+1/−1) column on `Vote` + a `score` projection + UI. It's a schema migration and a ranking
change — **recommended as a separate follow-up**, not in the fast-paced/realtime core. Flagged,
not assumed.

## Plan (phases — each: implement → `dotnet test` + `npm run build` → commit)

> **Prerequisite (blocking):** commit the current **114 uncommitted files** on
> `feat/dotnet-backend` as a checkpoint first, so this work doesn't tangle with in-flight WIP.
> (And stable shell access to `~/Documents` — see Risks.)

1. **Realtime v2 — backend.** `RealtimeNotifier` delta methods + broadcast enriched DTOs from
   `MessagesController` (post/vote/delete). Integration tests assert the new events fire with
   the right payload/groups.
2. **Realtime v2 — client.** Typed `realtime.ts` event API; room/thread/feed routes apply cache
   deltas (no refetch); optimistic vote + post. Manual + component tests.
3. **Per-room + global Hot.** `room_id` filter on `/highlights`; room view uses it; `/` becomes
   the global Hot feed. Tests for scoping.
4. **Feed UX.** Hot/New/Top tabs + `useInfiniteQuery` infinite scroll + "new posts" live insert/pill.
5. **(Optional) Downvotes + score** — schema migration + ranking + UI, if you want it.

Phase 1–2 deliver the "super real-time" headline; 3–4 the "fast-paced Reddit" feel.

## Risks / notes
- **114 uncommitted files** on the branch — must be committed before I layer changes, or they
  risk being tangled/lost. This is the #1 thing to do.
- **Environment:** shell access to `~/Documents` is currently intermittent (TCC/sandbox);
  building/testing/running the .NET API + frontend there has been flaky. Reliable hands-on
  implementation needs that stable (or build from a terminal with Full Disk Access).
- **`bun` not installed locally** — frontend builds via `npm` + the committed lockfile.
- Broadcasting the DTO must **exclude per-caller `voted`** (each client derives its own), or
  one user's vote state would leak into others' views.
