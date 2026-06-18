import { CheckCircle2 } from "lucide-react";
import { ProposalVoteControl } from "@/components/ProposalVoteControl";
import { sq } from "@/i18n/sq";
import type { Proposal } from "@/lib/sheshi";

// One civic proposal in a list. Mirrors MessageCard's shell (header chips → title/body → action row), but
// a proposal is a standalone titled demand, so there are no thread links — just the PRO/KUNDËR control.
export function ProposalCard({
  proposal,
  currentUserId,
}: {
  proposal: Proposal;
  currentUserId: string | null;
}) {
  const approved = proposal.status === "approved";
  const author = proposal.author?.display_name || proposal.author?.username || "Qytetar";

  return (
    <article className="rounded-xl border border-border bg-card/40 p-4 transition-colors hover:bg-card/60">
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-primary">
          {sq.proposals.category[proposal.category]}
        </span>
        {approved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-upvote/10 px-2 py-0.5 font-semibold text-upvote">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            {sq.proposals.status.approved}
          </span>
        )}
        <span className="ml-auto text-muted-foreground">{formatDate(proposal.created_at)}</span>
      </div>

      <h3 className="mt-2 text-base font-bold leading-snug">{proposal.title}</h3>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-normal text-foreground/80">
        {proposal.body}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{author}</span>
        <ProposalVoteControl proposal={proposal} currentUserId={currentUserId} />
      </div>
    </article>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("sq-AL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}
