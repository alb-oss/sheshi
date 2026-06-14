# Message caching + pagination (TanStack Query) — design + plan

**Date:** 2026-06-14
**Status:** proposed (not yet implemented)

## Problem

Rooms are now cached (#76), but **messages aren't**. The room feed (`dhoma.$slug.tsx`) and the
thread page (`tema.$messageId.tsx`) still fetch via raw `useEffect` + `useState`, so every entry to a
room/thread is a fresh network round-trip with a loading flash — even when you were just there.

Note: the feed is **not stale** — SignalR live-updates it. The win from caching is purely **instant
re-entry** (render the last-seen messages immediately, revalidate in the background) plus dedup.

## Current architecture (what must be preserved)

**Feed (`dhoma.$slug.tsx`)** — chat-ordered (newest at the bottom):
- `listMessages(roomId, cursor)` — cursor pagination; older history loads at the **top** via
  `loadMore()`, which captures `scrollHeight` before and re-anchors after (no jump).
- Realtime: `message_created` / `vote_changed` / `message_deleted` patch local `messages` state in
  place (no refetch).
- Scroll: scroll-to-bottom on first load; **feed-anchor restore** (sessionStorage) returns you to the
  exact post you opened a thread from.

**Thread (`tema.$messageId.tsx`)**:
- `getThread(messageId)` — single fetch of the whole reply tree (no pagination).
- Realtime patches the tree in place (`updateNode` / `insertUnderParent` / blank-on-delete).
- Scroll-to-bottom / new-reply follow.

## Design

Move the source of truth into the React Query cache; keep the realtime + scroll logic, just point it
at the cache instead of `useState`.

### Thread (do first — simpler)
```ts
const { data: thread } = useQuery({
  queryKey: ["thread", messageId],
  queryFn: () => getThread(messageId),
  staleTime: 15_000,
});
```
Realtime handlers call `queryClient.setQueryData(["thread", messageId], patch)` using the existing
`updateNode`/`insertUnderParent`/blank helpers (they already take + return immutable trees).

### Feed (infinite, cursor)
```ts
const q = useInfiniteQuery({
  queryKey: ["messages", roomId],
  queryFn: ({ pageParam }) => listMessages(roomId, pageParam),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.next_cursor,   // older history
  staleTime: 15_000,
});
const messages = q.data?.pages.flatMap((p) => p.items) ?? [];
```
- **Pagination:** `onScroll` near the top → `q.fetchNextPage()`; keep the pre-fetch `scrollHeight`
  capture + layout-effect re-anchor so older loads don't jump.
- **Realtime → cache patches** via `setQueryData(["messages", roomId], (data) => …)`:
  - `message_created`: append to the **first page's** `items` (page[0] holds the newest, since the
    feed is newest-first from the API and reversed for display). Dedup by id.
  - `vote_changed` / `message_deleted`: `map` over `pages[].items`.
- **Scroll:** unchanged — scroll-to-bottom on first settled load, and the `data-mid` feed-anchor
  restore still reads from the rendered DOM.

### Mutations (optimistic, removes more round-trips/flashes)
- Vote: `setVote` → optimistic `setQueryData` on the message's score, rollback on error.
- Post: append optimistically to the feed/thread cache, reconcile on the realtime echo (dedup by id).
- Delete: optimistic blank.

## Risks

The realtime patch logic is the delicate part — it must keep working identically. Mitigate by:
- Doing **thread first** (single query, no pagination) to validate the cache-patch pattern.
- Then the feed, in its own commit.
- **Manual verification each step:** post from a 2nd tab → appears live; vote → score updates without
  refetch; scroll up → older page loads with no jump; open a thread + back → lands on the exact post;
  re-enter a room → instant (no loading flash).

## Plan (atomic commits, separate PR per phase)

1. **docs** — this file.
2. **feat(web): thread via useQuery + cache-patched realtime** — convert `tema.$messageId.tsx`.
3. **feat(web): feed via useInfiniteQuery** — convert `dhoma.$slug.tsx` (pagination + realtime +
   scroll), keeping feed-anchor/scroll-restore.
4. **feat(web): optimistic vote/post/delete** — patch the query cache instead of refetching.

## Out of scope
- Offline/persisted cache, prefetching adjacent rooms, highlights/`/api/me` caching (separate, easy).
