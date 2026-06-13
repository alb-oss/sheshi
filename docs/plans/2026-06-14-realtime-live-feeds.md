# Realtime live feeds + feed UX — spec & plan (cont.)

**Branch:** `feat/realtime-live-feeds` (off `main`) · 2026-06-14 · builds on Phase 1a/1b.

## Done
- **Phase 1a** — backend broadcasts typed SignalR delta events (`message_created` /
  `vote_changed` / `message_deleted`) with payloads; snake_case SignalR.
- **Phase 1b** — room feed (`/dhoma/:slug`) applies those deltas to local state, no refetch.
- **Auth hardening** — OAuth-takeover + refresh-token-race fixes (merged).

## Decision (per request)
**Hot is GLOBAL only — no per-room Hot.** `/api/highlights` stays global; it surfaces in
the right-rail `HighlightsPanel` on every page. Room pages keep their chronological feed.

## Remaining work (each its own PR off main)

### A. Thread route delta-apply — `/tema/:id`  (this branch)
Today it does `on("changed") → full thread reload`. Replace with delta-apply over the
nested tree:
- `message_created` (a reply, `parent_id` set) → insert a node under its parent in place;
- `vote_changed` → update that node's `upvotes` (recursive find);
- `message_deleted` → blank the node in place.
Falls back to the existing reload only if a payload can't be placed (parent not loaded).

### B. Global Hot, live — `HighlightsPanel`
Ranking can't be delta-patched cheaply, so the panel refetches `/api/highlights` on a
**debounced** realtime tick (Hot is global + low-frequency). Replace its coarse refresh.

### C. Feed UX
- Home: **Hot / New / Top** tabs over the global highlights (client re-sort of the loaded set).
- Room feed: **infinite scroll** wired to the existing cursor API (`limit`+`cursor`).
- "**N new posts**" pill instead of auto-scroll when the user isn't at the top.

## Plan
1. **A — thread delta-apply** (this branch → PR).
2. **B — global Hot live** (next branch → PR).
3. **C — feed UX** (next branch → PR).

## Notes
- Frontend builds with `bun`/`make`; `npm` needs `--legacy-peer-deps`. Verify each change
  with `tsc --noEmit`, and `make build` before merge.
- Backend Phase 1a kept the legacy `"changed"` signal, so any not-yet-upgraded surface
  still works during the rollout.
