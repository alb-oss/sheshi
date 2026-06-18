import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { SheshiError, voteProposal, type Proposal } from "@/lib/sheshi";
import { applyProposalVoteToCaches } from "@/lib/proposal-cache";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// PRO / KUNDËR vote control for a proposal — the proposal analog of VoteControl. THE CACHE IS THE SINGLE
// SOURCE OF TRUTH: the highlight (my_vote) and the pro/kunder counts derive from the `proposal` prop, i.e.
// the React Query cache that both Kërkesat lists share. A click writes the new vote into every cache
// holding this proposal (optimistic + persisted) and the self-converging sender persists it (≤1 request in
// flight, always converging to the latest intent, never N stacked votes). Voting is disabled once the
// proposal is decided (only `proposed` is open).
export function ProposalVoteControl({
  proposal,
  currentUserId,
}: {
  proposal: Proposal;
  currentUserId: string | null;
}) {
  const queryClient = useQueryClient();
  const myVote = proposal.my_vote ?? 0; // derived truth — no useState for vote state
  const open = proposal.status === "proposed";

  const targetRef = useRef(myVote);
  const confirmedRef = useRef(myVote);
  const sendingRef = useRef(false);
  const idRef = useRef(proposal.id);

  // Reconcile network refs when the server's record changes underneath us, unless a write is pending.
  useEffect(() => {
    const idChanged = idRef.current !== proposal.id;
    idRef.current = proposal.id;
    const idle = !sendingRef.current && targetRef.current === confirmedRef.current;
    if (idChanged || idle) {
      targetRef.current = myVote;
      confirmedRef.current = myVote;
    }
  }, [proposal.id, myVote]);

  async function flush() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      while (targetRef.current !== confirmedRef.current) {
        const target = targetRef.current;
        try {
          await voteProposal(proposal.id, target as -1 | 0 | 1);
        } catch (error) {
          applyProposalVoteToCaches(queryClient, proposal.id, confirmedRef.current);
          targetRef.current = confirmedRef.current;
          toast.error(
            error instanceof SheshiError && error.code === "UNAUTH"
              ? sq.errors.auth
              : error instanceof SheshiError && error.code === "RATE_LIMITED"
                ? sq.errors.rateLimited
                : sq.proposals.voteFailed,
          );
          return;
        }
        confirmedRef.current = target;
      }
    } finally {
      sendingRef.current = false;
    }
  }

  function click(dir: 1 | -1) {
    if (!currentUserId) {
      toast.error(sq.proposals.signInToVote);
      return;
    }
    if (!open) {
      toast.error(sq.proposals.voteClosed);
      return;
    }
    const next = myVote === dir ? 0 : dir; // clicking your current vote clears it
    targetRef.current = next;
    applyProposalVoteToCaches(queryClient, proposal.id, next);
    void flush();
  }

  const base =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60";

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => click(1)}
        disabled={!open}
        aria-pressed={myVote === 1}
        aria-label={sq.proposals.pro}
        className={cn(
          base,
          myVote === 1
            ? "bg-upvote/15 text-upvote"
            : "text-muted-foreground hover:bg-upvote/10 hover:text-upvote",
        )}
      >
        <ThumbsUp className="h-4 w-4" fill={myVote === 1 ? "currentColor" : "none"} aria-hidden />
        <span>{sq.proposals.pro}</span>
        <span className="tabular-nums">{proposal.pro}</span>
      </button>
      <button
        type="button"
        onClick={() => click(-1)}
        disabled={!open}
        aria-pressed={myVote === -1}
        aria-label={sq.proposals.kunder}
        className={cn(
          base,
          myVote === -1
            ? "bg-downvote/15 text-downvote"
            : "text-muted-foreground hover:bg-downvote/10 hover:text-downvote",
        )}
      >
        <ThumbsDown
          className="h-4 w-4"
          fill={myVote === -1 ? "currentColor" : "none"}
          aria-hidden
        />
        <span>{sq.proposals.kunder}</span>
        <span className="tabular-nums">{proposal.kunder}</span>
      </button>
    </div>
  );
}
