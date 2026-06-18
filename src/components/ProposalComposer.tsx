import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { sq } from "@/i18n/sq";
import {
  PROPOSAL_CATEGORIES,
  SheshiError,
  submitProposal,
  type ProposalCategory,
} from "@/lib/sheshi";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// "Propozo" dialog — submit a new proposal. It lands in the moderator queue (Pending), so on success there
// is no public-list change to await; we invalidate the queue (for moderators) and toast that it's pending.
export function ProposalComposer({ trigger }: { trigger: ReactNode }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<ProposalCategory>("ligje");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setSubmitting(true);
    try {
      await submitProposal({ title, body, category });
      toast.success(sq.proposals.submitted);
      void queryClient.invalidateQueries({ queryKey: ["proposal-queue"] });
      setOpen(false);
      setTitle("");
      setBody("");
      setCategory("ligje");
    } catch (error) {
      toast.error(
        error instanceof SheshiError && error.code === "UNAUTH"
          ? sq.errors.auth
          : error instanceof SheshiError && error.code === "RATE_LIMITED"
            ? sq.errors.rateLimited
            : sq.errors.generic,
      );
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !title.trim() || !body.trim();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sq.proposals.propose}</DialogTitle>
          <DialogDescription>{sq.proposals.proposeHint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="proposal-title">{sq.proposals.titleLabel}</Label>
            <Input
              id="proposal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={sq.proposals.titlePlaceholder}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proposal-body">{sq.proposals.bodyLabel}</Label>
            <Textarea
              id="proposal-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={sq.proposals.bodyPlaceholder}
              maxLength={8000}
              rows={5}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{sq.proposals.categoryLabel}</Label>
            <div className="flex flex-wrap gap-2">
              {PROPOSAL_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                  className={cn(
                    "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                    category === c
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-foreground/70 hover:bg-card/70",
                  )}
                >
                  {sq.proposals.category[c]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onSubmit} disabled={disabled}>
            {sq.proposals.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
