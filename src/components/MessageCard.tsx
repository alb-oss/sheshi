import { Link } from "@tanstack/react-router";
import { ArrowUp, CornerDownRight, Flag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { sq as sqLocale } from "date-fns/locale";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";
import { SheshiError, toggleVote, softDeleteMessage, type MessageRow } from "@/lib/sheshi";
import { ReportDialog } from "./ReportDialog";
import { toast } from "sonner";

interface Props {
  message: MessageRow;
  roomSlug: string;
  currentUserId: string | null;
  onChanged?: () => void;
  asThreadLink?: boolean;
  compact?: boolean;
  onReply?: (message: MessageRow) => void;
}

export function MessageCard({
  message,
  roomSlug,
  currentUserId,
  onChanged,
  asThreadLink = true,
  compact,
  onReply,
}: Props) {
  const [voting, setVoting] = useState(false);
  const [optimisticUpvotes, setOptimisticUpvotes] = useState(message.upvotes ?? 0);
  const [optimisticVoted, setOptimisticVoted] = useState(!!message.voted);
  const [reportOpen, setReportOpen] = useState(false);
  const isDeleted = !!message.deleted_at;
  const isOwn = currentUserId && currentUserId === message.author_id;

  const name = message.author?.display_name || message.author?.username || "anonim";
  const handle = "@" + (message.author?.username || "anonim");
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const time = (() => {
    try {
      return formatDistanceToNow(new Date(message.created_at), { locale: sqLocale });
    } catch {
      return "";
    }
  })();

  useEffect(() => {
    setOptimisticUpvotes(message.upvotes ?? 0);
    setOptimisticVoted(!!message.voted);
  }, [message.id, message.upvotes, message.voted]);

  async function onVote() {
    if (!currentUserId) {
      toast.error(sq.chat.signInToPost);
      return;
    }
    if (voting) return;

    const previousVoted = optimisticVoted;
    const previousUpvotes = optimisticUpvotes;
    const nextVoted = !previousVoted;
    const nextUpvotes = Math.max(0, previousUpvotes + (nextVoted ? 1 : -1));

    setOptimisticVoted(nextVoted);
    setOptimisticUpvotes(nextUpvotes);
    setVoting(true);
    try {
      await toggleVote(message.id, previousVoted);
      onChanged?.();
    } catch (error) {
      setOptimisticVoted(previousVoted);
      setOptimisticUpvotes(previousUpvotes);
      toast.error(
        error instanceof SheshiError && error.code === "UNAUTH"
          ? sq.errors.auth
          : error instanceof SheshiError && error.code === "RATE_LIMITED"
            ? sq.errors.rateLimited
          : "Vota nuk u ruajt. Provo sërish.",
      );
    } finally {
      setVoting(false);
    }
  }

  async function onDelete() {
    if (!confirm("Fshij këtë mesazh?")) return;
    try {
      await softDeleteMessage(message.id);
      onChanged?.();
    } catch {
      toast.error(sq.errors.generic);
    }
  }

  return (
    <article className={cn("group flex gap-4 px-4 py-4 sm:px-6", compact && "gap-3 px-3 py-2.5")}>
      <div
        className={cn(
          "shrink-0 rounded-full bg-card border border-border/50 flex items-center justify-center font-bold text-foreground/70 overflow-hidden",
          compact ? "h-8 w-8 text-[10px]" : "h-10 w-10 text-[11px]",
        )}
        aria-hidden
      >
        {message.author?.avatar_url ? (
          <img src={message.author.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span>{initials || "??"}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-bold text-sm truncate">{handle}</span>
          <span className="text-[10px] text-foreground/30 font-medium tabular-nums">{time}</span>
        </div>

        <div
          className={cn(
            "text-[15px] leading-relaxed whitespace-pre-wrap break-words",
            isDeleted ? "italic text-foreground/40" : "text-foreground/90",
          )}
        >
          {isDeleted ? sq.chat.deleted : message.body}
        </div>
        {!isDeleted && message.image_url ? (
          <img
            src={message.image_url}
            alt=""
            className="mt-3 max-h-80 max-w-full rounded-sm border border-border object-contain"
            loading="lazy"
          />
        ) : null}

        {!isDeleted && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-4">
            <button
              type="button"
              onClick={onVote}
              disabled={voting}
              aria-label={sq.chat.upvote}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-sm px-1.5 text-xs font-bold transition-colors disabled:opacity-50",
                optimisticVoted ? "text-primary" : "text-foreground/40 hover:text-primary",
              )}
            >
              <ArrowUp className="w-3.5 h-3.5" aria-hidden />
              <span className="tabular-nums">{optimisticUpvotes}</span>
            </button>

            {(() => {
              const isTopLevel = message.parent_id === null;
              const replyClass = cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-sm px-1.5 text-xs font-bold uppercase tracking-widest transition-colors",
                message.reply_count
                  ? "text-foreground/70 hover:text-primary"
                  : "text-foreground/40 hover:text-primary",
              );
              const inner = (
                <>
                  <CornerDownRight className="w-3.5 h-3.5" aria-hidden />
                  <span>{sq.chat.reply}</span>
                  {isTopLevel && message.reply_count ? (
                    <span className="tabular-nums text-foreground/50">({message.reply_count})</span>
                  ) : null}
                </>
              );
              if (onReply) {
                return (
                  <button
                    type="button"
                    onClick={() => onReply(message)}
                    className={cn(
                      replyClass,
                      "-mx-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                    )}
                  >
                    {inner}
                  </button>
                );
              }
              if (isTopLevel && asThreadLink) {
                return (
                  <Link
                    to="/tema/$messageId"
                    params={{ messageId: message.id }}
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        window.sessionStorage.setItem("sheshi:reply-intent", message.id);
                      }
                    }}
                    className={replyClass}
                  >
                    {inner}
                  </Link>
                );
              }
              return null;
            })()}

            {currentUserId && !isOwn && (
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                aria-label={sq.chat.report}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border/70 text-foreground/60 transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary md:h-8 md:w-8 md:border-0 md:bg-transparent md:text-foreground/40 md:opacity-0 md:group-hover:opacity-100"
              >
                <Flag className="h-4 w-4 md:h-3.5 md:w-3.5" />
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={onDelete}
                aria-label={sq.chat.delete}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary md:opacity-0 md:group-hover:opacity-100"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} messageId={message.id} />
    </article>
  );
}
