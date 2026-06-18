import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listProposals, type ProposalCategory } from "@/lib/sheshi";
import { ensureRealtimeStarted, invokeRealtime } from "@/lib/realtime";
import { useRealtimeResync } from "@/hooks/use-realtime-resync";
import { applyMyProposalVoteToCaches, applyProposalTallyToCaches } from "@/lib/proposal-cache";

type PublicStatus = "proposed" | "approved";

export const proposalsKey = (status: PublicStatus, category: ProposalCategory | null) =>
  ["proposals", status, category ?? "all"] as const;

// Proposals change far less often than chat, are read on both Kërkesat tabs, and revalidate quietly after
// 60s — one shared, cached request per (status, category).
export function useProposals(status: PublicStatus, category: ProposalCategory | null) {
  return useQuery({
    queryKey: proposalsKey(status, category),
    queryFn: () => listProposals({ status, category }),
    staleTime: 60_000,
  });
}

// Wire the proposals feed to realtime. High-frequency vote tallies are patched into the cache in place;
// the rarer structural changes (published / approved / removed move a proposal between the two lists) just
// invalidate ['proposals'] — the simplest correct behaviour, since a precise cross-list move is fragile.
// Re-joins the group and refetches on reconnect / tab-foreground (group membership isn't kept across a
// reconnect, and a backgrounded tab misses fire-and-forget deltas).
export function useProposalsRealtime() {
  const queryClient = useQueryClient();

  useRealtimeResync(() => {
    void queryClient.invalidateQueries({ queryKey: ["proposals"] });
    void invokeRealtime("JoinProposals");
  });

  useEffect(() => {
    let disposed = false;
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["proposals"] });
    const onVote = (e: { proposal_id: string; score: number; pro: number; kunder: number }) =>
      applyProposalTallyToCaches(queryClient, e.proposal_id, {
        score: e.score,
        pro: e.pro,
        kunder: e.kunder,
      });
    const onMyVote = (e: { proposal_id: string; value: number }) =>
      applyMyProposalVoteToCaches(queryClient, e.proposal_id, e.value);

    const connectionPromise = ensureRealtimeStarted();
    connectionPromise
      .then((connection) => {
        if (disposed) return;
        connection.on("proposal_vote_changed", onVote);
        connection.on("my_proposal_vote_changed", onMyVote);
        connection.on("proposal_created", invalidate);
        connection.on("proposal_approved", invalidate);
        connection.on("proposal_removed", invalidate);
      })
      .catch(() => {});
    void invokeRealtime("JoinProposals");

    return () => {
      disposed = true;
      connectionPromise
        .then((connection) => {
          connection.off("proposal_vote_changed", onVote);
          connection.off("my_proposal_vote_changed", onMyVote);
          connection.off("proposal_created", invalidate);
          connection.off("proposal_approved", invalidate);
          connection.off("proposal_removed", invalidate);
        })
        .catch(() => {});
      void invokeRealtime("LeaveProposals");
    };
  }, [queryClient]);
}
