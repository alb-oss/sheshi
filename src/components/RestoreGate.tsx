import { useIsRestoring } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Hydration-safe gate for any region that reads a PERSISTED React Query (rooms / highlights / feed).
//
// The server has no localStorage, so those queries are empty server-side; the client restores the
// persisted cache and would otherwise render different content than the SSR HTML, which React 19's
// hydrateRoot rejects as a mismatch. PersistQueryClientProvider seeds isRestoring=true and only flips
// it to false in a post-commit effect, so `useIsRestoring()` is true on BOTH the server render and the
// first client render — gating on it makes the first client paint render the same `fallback` the server
// did (hydration succeeds), then the restored data paints one tick later with zero network round-trip.
// Persistence (instant-from-localStorage on refresh) is preserved; only the first commit is delayed.
export function RestoreGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return useIsRestoring() ? <>{fallback}</> : <>{children}</>;
}
