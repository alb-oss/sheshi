import { Link } from "@tanstack/react-router";
import { Flag, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { sq as sqLocale } from "date-fns/locale";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";
import { toggleVote, softDeleteMessage, type MessageRow } from "@/lib/sheshi";
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

  async function onVote() {
    if (!currentUserId) {
      toast.error(sq.chat.signInToPost);
      return;
    }
    setVoting(true);
    try {
      await toggleVote(message.id, !!message.voted);
      onChanged?.();
    } catch {
      toast.error(sq.errors.generic);
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
    <article className={cn("group flex gap-4 px-6 py-4", compact && "py-3")}>
      <div
        className="shrink-0 w-10 h-10 rounded-full bg-card border border-border/50 flex items-center justify-center text-[11px] font-bold text-foreground/70 overflow-hidden"
        aria-hidden
      >
        {message.author?.avatar_url ? (
          <img
            src={message.author.avatar_url}
            alt=""
            className="w-full h-full object-cover"
          />
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

        {!isDeleted && (
          <div className="mt-3 flex items-center gap-5">
            <button
              type="button"
              onClick={onVote}
              disabled={voting}
              aria-label={sq.chat.upvote}
              className={cn(
                "flex items-center gap-1.5 transition-colors text-xs font-bold disabled:opacity-50",
                message.voted
                  ? "text-primary"
                  : "text-foreground/40 hover:text-primary",
              )}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 15l7-7 7 7"
                />
              </svg>
              <span className="tabular-nums">{message.upvotes ?? 0}</span>
            </button>

            {(() => {
              const isTopLevel = message.parent_id === null;
              const replyClass = cn(
                "inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest transition-colors",
                message.reply_count
                  ? "text-foreground/70 hover:text-primary"
                  : "text-foreground/40 hover:text-primary",
              );
              const inner = (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a4 4 0 014 4v2m0 0l-3-3m3 3l-3 3" />
                  </svg>
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
                    className={cn(replyClass, "rounded-sm px-1 py-0.5 -mx-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary")}
                  >
                    {inner}
                  </button>
                );
              }
              if (isTopLevel && asThreadLink) {
                return (
                  <Link
                    to="/r/$slug/t/$messageId"
                    params={{ slug: roomSlug, messageId: message.id }}
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
                className="text-foreground/30 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={onDelete}
                aria-label={sq.chat.delete}
                className="text-foreground/30 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
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
