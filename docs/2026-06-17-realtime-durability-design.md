# Realtime durability & convergence — design

_2026-06-17_

## Goal

Apply the durable-streaming discipline (borrowed from the AI-harness two-tier write pattern) across
**all** of sheshi's realtime/streaming surfaces, not just votes, so that every client converges on the
server's truth — durably, after blips, backgrounding, and bursts — without hammering the DB or losing
in-progress work.

## The pattern, mapped to sheshi

The AI harness uses **two tiers**: a throttled, overwrite-in-place *scratchpad* (crash-recovery +
reconnect replay of an in-progress artifact) and an append-once *permanent log* (the source of truth).
The reason it needs both is that a streaming reply is **an artifact that is still becoming a fact**.

Sheshi's data splits cleanly:

| Kind | Example | Tier it needs |
|---|---|---|
| **Atomic fact** | a vote, a posted message, a delete | **Permanent log only** — it's a fact the instant it's written (`Votes`, `Messages` in Postgres). No scratchpad. |
| **Streaming artifact** | a post/reply being **composed** | **Scratchpad** — the genuine home for the two-tier pattern (autosave draft → commit on send). |

So the transferable principles for the **fact** surfaces are not "add a scratchpad" but:

1. **DB is the source of truth; realtime is a disposable overlay.**
2. **Events are idempotent** (carry absolute values / dedup by id) → safe to apply twice or out of order.
3. **Stable identity end-to-end** (message id, user id) → no flicker/duplicate.
4. **Reconcile from truth** on reconnect/foreground → catch up on anything the fire-and-forget stream missed.
5. **Coalesce high-frequency broadcasts** (the 250ms-throttle dial) → survive bursts/virality.

## Current state (audit)

| Principle | Status |
|---|---|
| Source of truth (Postgres `Votes`/`Messages`) | ✅ |
| Idempotent events: `vote_changed` (absolute score), `my_vote_changed` (absolute value), `message_created` (dedup by id), `message_deleted` (blank by id) | ✅ |
| Stable ids | ✅ |
| Reconcile on reconnect + foreground | ⚠️ **only on `dhoma` (feed) and `tema` (thread)** — not on `moderim`, `HighlightsPanel` (fokus/sidebar), or `index` (home) |
| Coalesced broadcasts | ✅ highlights (`HighlightsTicker`, 3 s leading+trailing) · ⚠️ **`vote_changed` is NOT coalesced** (one broadcast per vote → viral fan-out) |
| In-progress draft durability | ❌ none |
| Reconnect group re-join (#113) + hub re-auth on identity change (#115) | ✅ |

## Plan

### Phase 1 — Reconcile everywhere (reusable hook)
Extract the reconnect+foreground resync (currently inline in feed/thread) into a single
`useRealtimeResync(resync)` hook: fires `resync` on `onRealtimeReconnected` and on
`visibilitychange → visible`. Apply it to **every** realtime-backed view:
- `dhoma` feed → invalidate `["messages", roomId]`
- `tema` thread → invalidate `["thread", messageId]`
- `HighlightsPanel` → invalidate `["highlights", mode]`
- `moderim` → invalidate the moderation queue/metrics queries
- `index` (home) → invalidate `["rooms"]`

Guarantees every realtime view re-converges to truth after a blip/background — not just the two we
hand-wired.

### Phase 2 — Coalesce per-message vote broadcasts
Generalise the `HighlightsTicker` idea into a small **per-key debounced broadcaster** and use it for
`vote_changed`: at most one score broadcast **per message** per ~250 ms (leading edge immediate,
trailing timer guarantees the final absolute score). `my_vote_changed` stays immediate (per-user, low
volume). Protects a viral post from emitting O(votes) broadcasts to O(viewers).

### Phase 3 — Composer draft autosave (the two-tier scratchpad)
The one place the harness pattern fits literally. Debounced (~300 ms) autosave of the composer body to
`localStorage`, keyed by room + parent (the "scratchpad"); restore on mount; **clear on successful
send** (the "commit"). A crash, refresh, accidental navigation, or backgrounded phone never loses a
half-written post. Client-only — cross-device draft sync is deliberately out of scope (over-engineering
for a forum; a forum draft is device-local by nature).

## Explicitly out of scope (with rationale)
- **Transactional outbox** (guaranteed live delivery if the server crashes *between* DB commit and
  broadcast): the Phase-1 reconcile already self-heals this; an outbox is only worth it if you must
  guarantee *live* delivery without any client refetch. Revisit if that becomes a requirement.
- **Redis backplane + shared presence**: required only before running **more than one** API instance.
  Single instance today → in-memory groups/presence are correct. Track for horizontal scaling.
- **Per-message version/sequence numbers** for strict ordering: redundant — absolute-value idempotent
  events are already order-insensitive, and reconcile fixes any residual drift.

## Verification per phase
- **P1**: for each route, restart the API (force reconnect) and toggle tab visibility → the view
  refetches and re-converges.
- **P2**: fire a burst of N votes on one message → assert ≤ `ceil(N·Δt / interval)+1` broadcasts and a
  correct final absolute score.
- **P3**: type a draft → refresh/navigate away and back → draft restored; send → draft cleared.
