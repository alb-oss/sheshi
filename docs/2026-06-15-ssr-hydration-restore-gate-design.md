# SSR hydration mismatch from the persisted React Query cache — design + plan

**Date:** 2026-06-15
**Status:** in progress
**Author:** grounded in a 4-agent research pass (codebase map + two web-research reports + synthesis);
key sources cited below.

## Problem

Since the rooms cache became persisted (#80), and now highlights (#81) and the feed (#83), a **dev-mode
React 19 hydration mismatch** fires on every route. Captured warning:

> Hydration failed because the server rendered HTML didn't match the client … `<a href="/dhoma/realtime-test" …>` (client-only)

The mismatching node is the **`AppShell` sidebar room link** — reproducible on the untouched home route
`/`, so it is chrome-level, not specific to any one page.

## Root cause

`hydrateRoot` requires the **first client render to match the SSR HTML**. "Rendering different data on
the server and the client" is a named hydration error
([react.dev/hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot)).

- The **server has no `localStorage`** — `src/lib/query-persist.ts` swaps in a `noopStorage` on the
  server, and nothing is dehydrated into the SSR payload (`src/router.tsx` has no SSR-query
  integration). So the cache for `["rooms"]` / `["highlights"]` / `["messages"]` is empty server-side,
  and the persisted-data regions render their **empty branch** into the HTML.
- On the **client**, `PersistQueryClientProvider` (`src/routes/__root.tsx`) restores the persisted cache
  from `window.localStorage["sheshi:rq-cache"]`, and the same components re-render **with** rooms /
  highlights / feed. The populated tree is diffed against the empty SSR DOM → mismatch.
- `gcTime` 24h (`router.tsx`) ≥ `maxAge` 24h (`query-persist.ts`) makes the persisted cache reliably
  present, so the mismatch is **deterministic**, not intermittent.

The persisted-data regions that are SSR-rendered (from the codebase map):

| Region | File | Query | On every route? |
|---|---|---|---|
| Sidebar room list | `src/components/AppShell.tsx` (`useRooms`, the `nav` `rooms.map`) | `["rooms"]` | **yes** (chrome) |
| Highlights panel | `src/components/HighlightsPanel.tsx` (`["highlights", …]`) | `["highlights"]` | `/`, `/fokus`, `/dhoma/$slug`, `/tema/$messageId` |
| Room header + feed body | `src/routes/dhoma.$slug.tsx` (`["room", slug]` seeded via `initialData` from rooms; `["messages", roomId]`) | `["rooms"]`/`["messages"]` | the room route body |

Not affected: `src/routes/index.tsx` (home feed uses local `useState` + `listRooms()` in an effect, not
a persisted query); `src/routes/fokus.tsx` and `src/routes/tema.$messageId.tsx` read `useRooms` only to
build a `roomLookup` Map (no direct rooms render) and render `<HighlightsPanel>` (covered by its fix).
The thread body itself reads `["thread", id]`, which is **not** persisted, so it shows a skeleton on the
first paint on both server and client → no mismatch.

## Design

**Approach: a shared `<RestoreGate>` that gates each persisted-data region on `useIsRestoring()`, keeping
localStorage persistence exactly as-is.**

```tsx
// src/components/RestoreGate.tsx
import { useIsRestoring } from "@tanstack/react-query";
import type { ReactNode } from "react";

export function RestoreGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return useIsRestoring() ? <>{fallback}</> : <>{children}</>;
}
```

Why this is provably correct: `PersistQueryClientProvider` initializes `isRestoring = useState(true)` and
only flips it to `false` inside a **post-commit `useEffect`** (verified in
`node_modules/@tanstack/react-query-persist-client/build/modern/PersistQueryClientProvider.js`). So
`useIsRestoring()` is **`true` on the server render AND on the first client render** — a render keyed on
it produces the **same `fallback` in both**, hydration succeeds, and the restored rooms/highlights/feed
paint **one tick later with zero network round-trip**. The whole point of the persistence work —
instant-from-`localStorage` on hard refresh — is preserved (the gate delays one commit, not the data).

Because the server now also renders the `fallback`, the `fallback` may be a **skeleton** (deterministic,
SSR-safe) rather than empty markup — it improves perceived load and stays identical across server and
first client render by construction.

This is the library's own recommended pattern for this exact bug
([persistQueryClient docs](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient),
[TanStack/query#6472](https://github.com/TanStack/query/issues/6472),
[TanStack/query#6538](https://github.com/TanStack/query/discussions/6538)) — `useIsRestoring` ships in
`@tanstack/react-query` (v5.101.0 here), so no new dependency.

### Where it's applied

- **`src/components/RestoreGate.tsx`** — NEW shared gate (with a header doc block stating the
  server/first-client parity invariant).
- **`src/components/AppShell.tsx`** — wrap the `rooms.map` output (inside the existing
  `<nav className="space-y-1">`) in `<RestoreGate fallback={<SidebarRoomsSkeleton/>}>`. This is the
  every-route chrome fix.
- **`src/components/Skeletons.tsx`** — add a small `SidebarRoomsSkeleton` (a few `Skeleton` bars shaped
  like the nav items).
- **`src/components/HighlightsPanel.tsx`** — add `const isRestoring = useIsRestoring();` and change the
  content gate from `loading ?` to `loading || isRestoring ?`. The skeleton (already SSR-safe) becomes
  the first-client-render output. (Doesn't need `RestoreGate` — it already has a loading branch.)
- **`src/routes/dhoma.$slug.tsx`** — fold `isRestoring` into the existing `loading` flag:
  `const loading = isRestoring || roomQuery.isPending || (!!roomId && q.isPending);`. Required because the
  room header is seeded synchronously from the persisted rooms list via `initialData` and the feed from
  the persisted `["messages", roomId]` query, so the route **body** (not just chrome) can diverge.
- No change: `index.tsx`, `fokus.tsx`, `tema.$messageId.tsx`, `router.tsx`, `__root.tsx`,
  `query-persist.ts` (the allowlist + `gcTime ≥ maxAge` invariant are correct and untouched).

## Alternatives considered (rejected)

- **`suppressHydrationWarning`** — only works one level deep and "will not patch mismatched content"
  (React docs); it silences the warning but leaves the DOM wrong and can't fix a data-driven list with
  different children. Hides the bug.
- **`useHydrated`/`useIsClient` two-pass mount gate** — functionally close, but hand-rolls the
  post-commit effect `PersistQueryClientProvider` already runs, flips on *mount* rather than on *restore
  completion*, and React warns two-pass hydration "may feel jarring". `useIsRestoring()` is strictly more
  precise and already provided.
- **Official `setupRouterSsrQueryIntegration` + loader prefetch (SSR dehydrate/hydrate)** — the
  architecturally "most correct" long-term path, but it makes the server fetch rooms/highlights/messages
  per request and **removes** instant-from-`localStorage`, which is the entire point of the persistence
  work. Deferred as a future SEO/first-paint upgrade, not adopted now.
- **`ClientOnly`** — eliminates the mismatch but forfeits SSR for those regions (blank shell in the
  initial HTML, worse CLS). `useIsRestoring` keeps the static shell SSR'd while gating only the inner
  data-dependent content.

## Risks

Low. Primary risk is **incompleteness** — missing a persisted-data region (the easy-to-miss one is the
`dhoma` body); mitigated by the shared gate + a grep guard in verification. Secondary: **fallback drift**
— each fallback must stay markup-identical across server and first client render (guaranteed here because
both render the same `fallback`). No security/persistence change: the success-only PUBLIC-prefix
dehydrate allowlist and `gcTime ≥ maxAge` invariant are untouched; the server still emits no persisted
user data.

## Verification

1. **Reproduce first** — `vite dev`, warm the cache, hard-refresh `/`; confirm the hydration warning
   appears (capture the text for the commit body).
2. **After the fix** — hard-refresh `/`, `/dhoma/<slug>`, `/fokus`, `/tema/<id>` with a warm cache;
   assert **no** "didn't match" warning in the console on any.
3. **Instant-from-cache preserved** — with network throttled/offline, hard-refresh a warm route and
   confirm rooms/highlights/feed still render from the persisted cache (gate delays one commit, not data).
4. **SSR shell integrity** — `curl` the route; assert the static `AppShell` chrome + skeleton states are
   in the raw HTML and **no** persisted room names/highlight bodies leak server-side.
5. **Cold load** — clear `localStorage`, load `/` and a room route; assert no warning and skeletons
   resolve to fetched data.
6. **Build** — `tsc`, `eslint`, `vite build` clean.
7. **Regression guard** — grep for SSR-rendered persisted-query reads; confirm each is behind
   `RestoreGate` or an `isRestoring`-aware loading flag.

## Plan (atomic commits, one PR)

1. **docs** — this file.
2. **feat(web): RestoreGate + SidebarRoomsSkeleton** — the shared gate and the skeleton.
3. **fix(web): gate persisted-data regions on useIsRestoring** — AppShell sidebar, HighlightsPanel,
   dhoma body.

## Out of scope

SSR dehydrate/hydrate of the query cache (the `setupRouterSsrQueryIntegration` upgrade) — a separate,
larger change for SEO/first-paint content, to be paired with `RestoreGate` for any non-prefetched query.
