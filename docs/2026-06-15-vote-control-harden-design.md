# Hardening the up/down vote control — design + plan

**Date:** 2026-06-15
**Status:** in progress

## Bug

Pressing a vote button fast transiently shows a wrong score (e.g. **2** from a single user) and loses the
caller's highlighted state.

## Root cause (client-only)

The server is already correct: `Vote` has a composite PK `(MessageId, UserId)`
(`AppDbContext.cs:38`), so there is **at most one vote row per user per message**, and the score is
`SUM(Value)` recomputed server-side (`MessagesController.Vote`). It cannot double-count.

The realtime echo `vote_changed` carries **only `{ message_id, score }`** — never the per-user `my_vote`
(`RealtimeNotifier.VoteChangedAsync`). The feed/thread handlers patch the cached message's `score` but
leave its `my_vote` stale. Then `VoteControl`'s sync effect
(`useEffect(… , [message.id, message.score, message.my_vote])`) re-runs on every echo and **clobbers the
optimistic `myVote` back to the stale cached value (usually 0)**. The button then shows the new score but
an un-highlighted state, and the next fast click computes its delta from `prevVote = 0` → **double
applies** → "2". Compounding it: every click fires its own `PUT` (writes are limited to **30/60s**), so a
burst can 429 and roll back.

## Fix (VoteControl, client-only)

1. **Overlay model — the echo can never desync the caller's own vote.** Track two values: `myVote` (the
   caller's optimistic intent) and `confirmedVote` (the value the server has recorded for the caller,
   which `message.score` already includes). Render
   `displayScore = (message.score ?? 0) − confirmedVote + myVote`. When idle (`myVote === confirmedVote`)
   this equals `message.score`; an in-flight click overlays its delta; another user's echo only moves
   `message.score`. `myVote`/`confirmedVote` reset from props **only when `message.id` changes** (or when
   a refetch delivers a new `my_vote` and nothing is pending) — never on a bare score echo.
2. **Coalesced, self-converging send.** Keep one request in flight at a time; when it settles, if the
   caller's intent changed during the flight, send the latest. A burst of taps becomes ~1–2 requests
   (not one per tap), the final intent is always persisted, and rapid toggles never stack. On error,
   revert `myVote` to `confirmedVote` and toast. Buttons stay enabled (instant optimistic UI).

No server change: the composite PK already makes each write idempotent; concurrent same-user writes are
rejected by the PK (no corruption), and the new client coalescing keeps a single client from racing
itself.

## Verification

- Mash upvote ~10×: score lands on **+1** (not 2/3/…), highlight stays correct, exactly one net request
  per burst (DevTools network), no 429.
- Up → down → up rapidly: settles on the last intent, score correct.
- Two browsers: A votes, B sees the score move via the echo with no effect on B's own highlight.
- `tsc` + `eslint` + `vite build` clean.

## Plan

1. **docs** — this file.
2. **fix(web): harden VoteControl** — overlay model + coalesced send.
