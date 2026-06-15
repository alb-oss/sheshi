import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Query } from "@tanstack/react-query";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

// No-op storage on the server (no localStorage). This module is evaluated in both environments under
// TanStack Start; restoration itself only runs in a client effect, so the server never touches it.
const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const queryPersister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : noopStorage,
  key: "sheshi:rq-cache",
});

// Allowlist of query-key prefixes that are safe to write to disk — only PUBLIC reads. Anything
// user-specific or sensitive is never persisted, even if a future query forgets to opt out.
const PERSISTED_PREFIXES = new Set<string>(["rooms"]);

export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: queryPersister,
  maxAge: 1000 * 60 * 60 * 24, // 24h — discard anything older on restore
  buster: "v1", // bump to drop the whole persisted cache on a breaking change
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) =>
      query.state.status === "success" &&
      typeof query.queryKey[0] === "string" &&
      PERSISTED_PREFIXES.has(query.queryKey[0]),
  },
};
