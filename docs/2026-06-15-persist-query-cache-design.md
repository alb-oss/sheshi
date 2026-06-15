# Persist the React Query cache — instant page refresh

**Date:** 2026-06-15
**Status:** accepted

## Problem

A full page **refresh** is slow even though in-app navigation is fast. React Query's cache is
**in-memory only**, so every reload starts cold: the SSR shell has no data (there are no route
loaders), then the browser must download the JS, hydrate, and only then fire the client fetches
(`/api/me`, rooms, …) — a waterfall, repeated on every refresh. The rooms caching (#76) helps SPA
navigation but evaporates on reload.

## Solution

Persist the React Query cache to `localStorage` and restore it on load, so a refresh **paints from
disk immediately** and revalidates stale entries in the background (stale-while-revalidate). The data
the user just saw is there before any network call returns.

This is the foundation; its payoff grows as more reads move into React Query (rooms today; messages
per `2026-06-14-message-caching-design.md`, plus `/api/me`/highlights later). Whatever is in the
cache survives the refresh.

## Design

`@tanstack/react-query-persist-client` + `@tanstack/query-sync-storage-persister`.

- **Provider:** swap `QueryClientProvider` → `PersistQueryClientProvider` in `__root.tsx`, passing
  `persistOptions`. The provider **pauses queries while restoring** (its `IsRestoring` context), so
  there's no restore-vs-fetch double request; after restore, queries resolve from cache instantly or
  refetch only if stale.
- **Persister:** `createSyncStoragePersister({ storage })` where `storage` is `window.localStorage`
  on the client and a no-op stub on the server (this module evaluates in both environments under
  TanStack Start). Restoration runs in an effect → client-only → no SSR/hydration mismatch (first
  client render still matches the SSR shell, then restore fills it in).
- **`gcTime`:** raise the QueryClient default to 24h so cached entries aren't garbage-collected before
  they can be persisted/restored.
- **`persistOptions`:**
  - `maxAge: 24h` — discard anything older on restore.
  - `buster: "v1"` — bump to drop the whole persisted cache on a breaking change/deploy.
  - `dehydrateOptions.shouldDehydrateQuery` — **allowlist**: persist only **successful, public**
    reads (start with `["rooms"]`). User-specific/sensitive queries are never written to disk.

## Security / correctness

- **Allowlist, not blocklist:** only explicitly-public query keys are persisted, so nothing private
  lands in `localStorage` even as new queries are added carelessly.
- **Logout:** `signOutLocal()` calls `persister.removeClient()` to wipe the persisted cache. (Only
  public `rooms` is cached today, so this is mostly future-proofing; when user-specific queries move
  to React Query, also `queryClient.clear()` on logout — noted as a follow-up.)
- **Staleness:** SWR means a brief cached render may be replaced by fresh data; per-query `staleTime`
  (rooms = 60s) controls how often that revalidate fires.

## Risks

- Hydration mismatch → avoided (same provider on server+client; restore is a client effect).
- Private data on disk → avoided (success + allowlist dehydrate filter).
- Cache bloat → `maxAge` + `buster` + success-only.

## Plan (one PR, atomic commits)

1. **docs** — this file.
2. **perf(web): persist the query cache** — add deps; `query-persist.ts` (persister + options);
   `PersistQueryClientProvider` in `__root.tsx`; 24h `gcTime` in `router.tsx`.
3. **perf(web): clear persisted cache on logout** — `persister.removeClient()` in `signOutLocal`.

## Out of scope
- Moving `/api/me`, highlights, messages into React Query (separate PRs — they amplify this).
- SSR route loaders (the other, bigger lever for first-paint).
