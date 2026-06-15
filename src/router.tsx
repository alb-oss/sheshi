import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // gcTime must be ≥ the persister's maxAge, or cached entries get garbage-collected before they can
  // be persisted/restored across a refresh.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 1000 * 60 * 60 * 24 } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload route loaders on intent (touch/hover) so the thread route's loader doesn't block the
    // feed→thread tap; a short freshness window lets the click reuse the preloaded data.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};
