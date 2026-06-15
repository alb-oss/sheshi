# Message caching + pagination — implementation spec

**Date:** 2026-06-15
**Status:** in progress
**Supersedes the implementation detail of:** `docs/2026-06-14-message-caching-design.md` (the original proposal; this doc is the build-grade version, grounded in the actual code).

## Problem

Rooms (#76) and the Në Fokus highlights panel (#81) are cached + persisted via TanStack Query, so
re-entry and refresh are instant. **Messages are not.** Both message surfaces still fetch via raw
`useEffect` + `useState`:

- **Feed** — `src/routes/dhoma.$slug.tsx`: `listMessages(room.id, cursor)` into `useState`, cursor
  pagination, realtime patches `setMessages`.
- **Thread** — `src/routes/tema.$messageId.tsx`: `getThread(messageId)` into `useState`, realtime
  patches the reply tree in place.

So every entry to a room or thread is a fresh network round-trip with a loading flash — even when you
were just there a second ago — and nothing survives a hard refresh.

The feed/thread are **not stale** while mounted (SignalR live-updates them). The win from caching is
purely: (1) **instant re-entry** — render the last-seen tree immediately, revalidate quietly; (2) for
the feed, **instant on hard refresh** (persisted to `localStorage`); (3) dedup of concurrent reads.

## Goals / non-goals

**Goals**
- Move the source of truth for feed + thread into the React Query cache.
- Keep the realtime delta-apply and all scroll behaviour **byte-for-byte equivalent** to today.
- Persist the **feed** so a hard refresh of a room renders instantly from `localStorage`.

**Non-goals (explicitly out of scope this round)**
- Persisting **threads** — unbounded by number of threads opened; in-memory cache only.
- True optimistic message *insert* (showing your post before the server echo). Votes already are
  optimistic locally; posts rely on the realtime echo + an invalidate fallback. Optimistic insert
  would require a `Composer.onPosted(createdRow)` signature change — deferred.
- Prefetching adjacent rooms; `/api/me` caching (separate, low value).

## Current architecture (must be preserved)

### Feed — `dhoma.$slug.tsx` (chat order: newest at the **bottom**)
- `messages` is **newest-first** in state; the JSX `.slice().reverse()`s for display so the latest
  renders at the bottom (`dhoma.$slug.tsx:289`).
- `reload()` (`:79`) fetches page 1, replaces `messages`, resets `cursor`, and decides the initial
  scroll. `loadMore()` (`:116`) appends older pages at the array tail (= top of the reversed view).
- Realtime (`:190`): `message_created` (top-level → prepend; reply → bump ancestor `reply_count`),
  `vote_changed` (map score), `message_deleted` (blank in place).
- Scroll (the delicate part):
  - **Initial**: feed-anchor (the exact post you opened a thread from, `sheshi:feed-anchor:<slug>`)
    → else saved offset (`sheshi:feed-scroll:<slug>`) → else jump to bottom. Applied in a
    `useLayoutEffect` keyed on `messages` (`:154`).
  - **Older load**: capture `scrollHeight` before, re-anchor `scrollTop` after, so the viewport
    doesn't jump (`:120`, `:157`).
  - **New realtime message**: follow to bottom if already near the bottom, else show the
    "N postime të reja ↓" pill (`:196`).
  - `onScroll` (`:136`): saves `scrollTop`; triggers `loadMore()` when `scrollTop < 400`.

### Thread — `tema.$messageId.tsx`
- `getThread(messageId)` returns `{ root, replies }` — the whole reply tree, no pagination.
- Pure immutable tree helpers already exist and are reused as-is: `updateNode`, `hasNode`,
  `insertUnderParent` (`:31`–`:57`), plus a local `blank()` for soft-delete.
- Realtime (`:147`): `message_created` (insert under parent, or refetch if the parent isn't loaded),
  `vote_changed` (patch score), `message_deleted` (blank).
- Scroll: on (re)load, if you were near the bottom **or** a genuinely new last-reply arrived, smooth
  scroll to bottom (`:108`–`:119`). First load lands at the bottom.

## Design

> One rule: **the cache is the only source of truth.** The realtime handlers and the `reload`/`reply`
> paths stop touching `useState` and instead call `queryClient.setQueryData` / `invalidateQueries`.
> The scroll logic is unchanged in spirit — it just reads/writes the same DOM as today.

### Query keys & config

| Surface | Key | Hook | staleTime | persisted? |
|---|---|---|---|---|
| Feed | `["messages", roomId]` | `useInfiniteQuery` | 30s | **yes** (`"messages"` → allowlist) |
| Thread | `["thread", messageId]` | `useQuery` | 15s | no (in-memory only) |
| Room (by slug) | `["room", slug]` | `useQuery` + `initialData` from rooms cache | 60s | no (rooms list is persisted and seeds `initialData`) |

Both message queries set **`refetchOnWindowFocus: false`** — realtime keeps them fresh while mounted,
and refetching every page of an infinite query on every focus is wasteful and can disturb scroll.
`gcTime` is already 24h globally (`router.tsx`), satisfying the persister's `maxAge`.

### Thread (Phase 1 — do first, single query, no pagination)

```ts
const queryClient = useQueryClient();
const { data: thread, isPending: loading } = useQuery({
  queryKey: ["thread", messageId],
  queryFn: () => getThread(messageId),
  staleTime: 15_000,
  refetchOnWindowFocus: false,
});
```

- `getThread` resolves `null` on 404 → `data === null` is the "Tema nuk u gjet" state (not an error).
- **Realtime → cache patches.** The three handlers keep their exact logic; only the sink changes from
  `setThread(prev => …)` to `queryClient.setQueryData<ThreadData | null>(["thread", messageId], prev => …)`.
  The pure helpers (`updateNode` / `insertUnderParent` / `hasNode` / `blank`) are untouched. The
  "parent not loaded → reload()" fallback becomes
  `queryClient.invalidateQueries({ queryKey: ["thread", messageId] })`.
- **`onChanged` (delete from a `MessageCard`)** → `invalidateQueries({ queryKey: ["thread", messageId] })`
  (the realtime `message_deleted` echo also blanks it; the invalidate is the no-realtime safety net,
  and it does **not** scroll).
- **`onPosted` (your reply)** → clear the reply target, set a scroll-to-bottom intent, and
  `invalidateQueries`. The realtime echo + the refetch converge via id dedup.

**Scroll model (thread).** Replaces the `reload()`-embedded logic with explicit intents:
- `hadDataRef` (per `messageId`) — false until the first data arrives; reset in an effect on
  `messageId`. First data → set `scrollToBottomRef` (land at the bottom, `behavior:"auto"`).
- Realtime `onCreated`: measure `wasAtBottom` from `scrollRef` **before** `setQueryData`; if true, set
  `scrollToBottomRef` (so a new reply follows only when you're already at the bottom).
- A `useLayoutEffect` keyed on `thread` consumes `scrollToBottomRef` (smooth after first load) and
  records `lastReplyIdRef`.

### Feed (Phase 2 — infinite, cursor; the higher-risk surface)

```ts
const q = useInfiniteQuery({
  queryKey: ["messages", roomId],
  queryFn: ({ pageParam }) => listMessages(roomId, pageParam),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.next_cursor,   // older history
  staleTime: 30_000,
  refetchOnWindowFocus: false,
});
const messages = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
```
`page[0].items` is the newest 40 (newest-first); later pages are older. `messages` stays newest-first,
exactly like today, and the JSX keeps its `.slice().reverse()`.

- **Pagination** — `loadMore()` becomes self-contained and decoupled from the shared scroll effect
  (more robust than the old shared-ref approach):
  ```ts
  const loadMore = async () => {
    if (!room || !q.hasNextPage || q.isFetchingNextPage) return;
    const el = scrollRef.current;
    const before = el?.scrollHeight ?? 0;
    await q.fetchNextPage();
    requestAnimationFrame(() => {
      const el2 = scrollRef.current;
      if (el2) el2.scrollTop += el2.scrollHeight - before;   // re-anchor: older load never jumps
    });
  };
  ```
- **Realtime → cache patches** via `setQueryData<InfiniteData<CursorPage<MessageRow>>>(["messages", roomId], …)`:
  - `message_created`, top-level in this room → prepend to **page[0]** `items`, dedup by id.
  - `message_created`, a reply (`root_id` set) → `map` every page's `items`, bump the ancestor's
    `reply_count`.
  - `vote_changed` / `message_deleted` → `map` every page's `items`.
  - The near-bottom-follow vs "new posts ↓" pill decision is made in the handler (measure before patch)
    exactly as today.
- **Initial scroll** — gated by a new `didInitialScrollRef` (reset on `roomId`), since `q.isPending`
  is no longer the trigger when data restores instantly from cache. A `useLayoutEffect` runs the
  anchor → saved-offset → bottom decision once, the first time `messages.length > 0` for this room.
- **`onScroll`, the pill, the "N messages" button** — unchanged.
- **`onChanged` / `onPosted`** — `invalidateQueries({ queryKey: ["messages", roomId] })` (+ a
  scroll-to-bottom intent for `onPosted`). Background refetch of an infinite query revalidates all
  loaded pages; posts/deletes are infrequent, and id dedup keeps the realtime echo consistent.

> **Intentional behaviour change (improvement):** background revalidation no longer yanks the viewport
> to the bottom. Only the initial load, your own post, and a near-bottom realtime arrival scroll. The
> old `reload()` collapsed history to page 1 on every call; the cache keeps all loaded pages.

### Room

```ts
const { data: rooms = [] } = useRooms();
const { data: room = null } = useQuery({
  queryKey: ["room", slug],
  queryFn: () => getRoomBySlug(slug),
  initialData: () => rooms.find((r) => r.slug === slug) ?? undefined,
  staleTime: 60_000,
});
```
The persisted rooms list seeds `initialData`, so on a warm refresh the room header renders instantly;
`getRoomBySlug` still backstops a direct deep-link before the list has loaded.

### Persistence

Add `"messages"` to `PERSISTED_PREFIXES` in `src/lib/query-persist.ts`. The feed is **public** content,
bounded by the (small, curated) number of rooms a user opens — acceptable `localStorage` footprint,
discarded after the 24h `maxAge`. Threads are deliberately **not** persisted (unbounded count). The
existing allowlist gate, the logout wipe (`signOutLocal`), and `buster:"v1"` all still apply.

## Risks & mitigations

- **Realtime cache-patch correctness** is the crux. Mitigate by shipping **thread first** (one query,
  no pagination) to validate the `setQueryData` pattern, then the feed in its own PR.
- **Scroll regressions** (older-load jump, lost feed-anchor, broken follow-to-bottom). Mitigate by
  decoupling older-load anchoring into `loadMore` (await + RAF) and gating the initial scroll behind
  `didInitialScrollRef` instead of `loading`.
- **Infinite-query refetch cost** on stale mount/invalidate (N page requests). Mitigate with
  `staleTime: 30s`, `refetchOnWindowFocus: false`, and reliance on realtime while mounted.
- **Browser MCP has been flaky** — verification will lean on `tsc` + `vite build` plus a best-effort
  live pass; any scroll/realtime behaviour I cannot confirm end-to-end will be called out honestly.

## Verification checklist (per phase)

- Re-enter a room/thread you just left → **instant**, no loading flash.
- Hard refresh inside a room → feed renders instantly from `localStorage`, then revalidates.
- Post from a 2nd tab → appears live (feed at bottom / thread under its parent), no refetch flash.
- Vote → score updates with no refetch; rolls back on a forced error.
- Scroll up → older page loads with **no jump**.
- Open a thread from mid-feed, then back → lands on the **exact** post (feed-anchor).
- Delete your own message → blanks in place, no full reload.
- Logout → persisted cache cleared (no feed in `localStorage`).
- `npx tsc --noEmit` clean; `npm run frontend:build` (SSR) succeeds.

## Plan (one PR per phase, atomic commits)

1. **docs** — this file.
2. **feat(web): thread via useQuery + cache-patched realtime** — convert `tema.$messageId.tsx`.
3. **feat(web): feed via useInfiniteQuery** — convert `dhoma.$slug.tsx` (pagination + realtime +
   scroll), convert room to `["room", slug]`, add `"messages"` to the persist allowlist.
