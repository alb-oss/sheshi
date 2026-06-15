# Server-render thread pages for SEO + link unfurls

**Date:** 2026-06-15
**Status:** in progress
**Scope:** `src/routes/tema.$messageId.tsx` (+ a `defaultPreload` tweak in `src/router.tsx`).

## Problem

Thread pages render **empty server-side** — the body comes from a client `useQuery`, and the `head()`
is a generic `"Tema — Sheshi"`. So crawlers/Google see a blank shell with no per-thread title, and a
shared thread link unfurls with no content. Threads are the app's main shareable/indexable content.

## Design — `loader` + `initialData` (hydration-safe, no dehydration package)

Add a route **`loader`** that fetches the thread server-side and returns `{ thread }`. TanStack Start
serializes loader data to the client, so:

- **`head({ loaderData })`** builds a real title + `description`/`og`/`twitter` tags from the root
  message → crawlers and unfurls get the discussion text.
- The component seeds its existing `useQuery(["thread", id])` with **`initialData: loaderData.thread`**,
  so the body renders with content on **both** the server and the first client render — **identical
  markup → no hydration mismatch** — and there's **no double-fetch** (the loader replaces the query's
  initial fetch).

Why this avoids the mismatch (the thing the earlier `RestoreGate` work fought): the data is present on
both sides via serialized loader data, so server HTML == first client render. The thread isn't in the
persisted-cache allowlist, so `RestoreGate` is not involved.

Two render-time bits derive from non-SSR sources and are made consistent so the SSR'd body matches the
first client render:
- The header **back-link slug** comes from the persisted rooms cache (empty server-side), so it's gated
  on `useIsRestoring()` — the default until restore, then the real slug.
- The **relative timestamp** is "now"-based, so `MessageCard`'s time span gets `suppressHydrationWarning`.

Notes / trade-offs:
- The server fetch is anonymous (no token server-side), so `my_vote` is 0 in the SSR'd payload; the
  realtime echo / a later refetch corrects the caller's own vote highlight (cosmetic, ≤ staleTime).
- A 404 thread → `initialData` undefined → skeleton then "not found" (rare, not SEO-critical).
- `defaultPreload: "intent"` is enabled so feed→thread taps preload the loader on touch/hover and stay
  snappy (the loader otherwise briefly blocks navigation).

Rooms already emit slug-based `head()` meta and the feed is entangled with the persisted infinite-query
+ `RestoreGate`, so SSR'ing the room body is deliberately **out of scope** here (lower SEO value, higher
risk). This PR targets the high-value thread route.

## Verification

- `curl` a thread's SSR HTML → contains the real `<title>`/`og:description` **and** the thread body text.
- Browser: no hydration mismatch in the console on a thread load; thread renders; realtime/scroll intact.
- `tsc` + `eslint` + `vite build` clean.

## Plan

1. **docs** — this file.
2. **feat(web): SSR thread pages via loader + initialData** — thread route + router preload.
