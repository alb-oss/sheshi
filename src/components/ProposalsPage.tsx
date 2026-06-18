import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ProposalCard } from "@/components/ProposalCard";
import { ProposalComposer } from "@/components/ProposalComposer";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useProposals, useProposalsRealtime } from "@/hooks/use-proposals";
import {
  listProposalQueue,
  reviewProposal,
  PROPOSAL_CATEGORIES,
  type Proposal,
  type ProposalCategory,
} from "@/lib/sheshi";
import { canModerate } from "@/lib/roles";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";

type PublicStatus = "proposed" | "approved";

// Shared chrome for both Kërkesat lists. The two routes are thin wrappers passing `status`. Realtime is
// wired once here; vote tallies patch the cache live and structural moves invalidate.
export function ProposalsPage({ status }: { status: PublicStatus }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isMod = canModerate(user);
  const [category, setCategory] = useState<ProposalCategory | null>(null);

  useProposalsRealtime();
  const { data: proposals = [], isLoading } = useProposals(status, category);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <Tabs status={status} />
        <CategoryFilter value={category} onChange={setCategory} />

        {status === "proposed" && (
          <div className="mb-4 flex justify-end">
            {userId ? (
              <ProposalComposer
                trigger={
                  <Button>
                    <Plus className="h-4 w-4" />
                    {sq.proposals.proposeShort}
                  </Button>
                }
              />
            ) : (
              <Button onClick={() => toast.error(sq.proposals.signInToPropose)}>
                <Plus className="h-4 w-4" />
                {sq.proposals.proposeShort}
              </Button>
            )}
          </div>
        )}

        {status === "proposed" && isMod && <ModeratorQueue category={category} />}

        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{sq.proposals.loading}</p>
        ) : proposals.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {status === "approved" ? sq.proposals.emptyApproved : sq.proposals.emptyProposed}
          </p>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} currentUserId={userId} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Tabs({ status }: { status: PublicStatus }) {
  const tab = "flex-1 rounded-lg px-4 py-2 text-center text-sm font-semibold transition-colors";
  const active = "bg-card text-primary";
  const idle = "text-foreground/60 hover:bg-card/50 hover:text-foreground";
  return (
    <div className="mb-4 flex gap-2 rounded-xl bg-background p-1">
      <Link to="/kerkesat-e-propozuara" className={cn(tab, status === "proposed" ? active : idle)}>
        {sq.proposals.propozuara}
      </Link>
      <Link to="/kerkesat-e-miratuara" className={cn(tab, status === "approved" ? active : idle)}>
        {sq.proposals.miratuara}
      </Link>
    </div>
  );
}

function CategoryFilter({
  value,
  onChange,
}: {
  value: ProposalCategory | null;
  onChange: (v: ProposalCategory | null) => void;
}) {
  const chip = "rounded-full px-3 py-1 text-sm font-medium transition-colors";
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={cn(
          chip,
          value === null
            ? "bg-primary text-primary-foreground"
            : "bg-card text-foreground/70 hover:bg-card/70",
        )}
      >
        {sq.proposals.all}
      </button>
      {PROPOSAL_CATEGORIES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-pressed={value === c}
          className={cn(
            chip,
            value === c
              ? "bg-primary text-primary-foreground"
              : "bg-card text-foreground/70 hover:bg-card/70",
          )}
        >
          {sq.proposals.category[c]}
        </button>
      ))}
    </div>
  );
}

// Moderator-only review queue — Pending proposals awaiting a publish/reject decision.
function ModeratorQueue({ category }: { category: ProposalCategory | null }) {
  const queryClient = useQueryClient();
  const { data: pending = [] } = useQuery({
    queryKey: ["proposal-queue", category ?? "all"],
    queryFn: () => listProposalQueue(category),
    staleTime: 30_000,
  });

  async function decide(id: string, action: "publish" | "reject") {
    try {
      await reviewProposal(id, action);
      toast.success(action === "publish" ? sq.proposals.published : sq.proposals.rejectedToast);
      void queryClient.invalidateQueries({ queryKey: ["proposal-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["proposals"] });
    } catch {
      toast.error(sq.errors.generic);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-dashed border-border p-3">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-foreground/50">
        {sq.proposals.queueTitle}
      </h2>
      {pending.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{sq.proposals.queueEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((p: Proposal) => (
            <li key={p.id} className="rounded-lg bg-card/40 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-wide text-primary">
                  {sq.proposals.category[p.category]}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold">{p.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-foreground/70">{p.body}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => decide(p.id, "publish")}>
                  {sq.proposals.publish}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => decide(p.id, "reject")}>
                  {sq.proposals.reject}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
