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
    defaultPreloadStaleTime: 0,
  });

  return router;
};
