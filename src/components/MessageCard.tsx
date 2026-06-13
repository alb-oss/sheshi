import { Link } from "@tanstack/react-router";
import {
  ArrowBigUp,
  Bookmark,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Flag,
  Share2,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { sq as sqLocale } from "date-fns/locale";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";
import { SheshiError, toggleVote, softDeleteMessage, type MessageRow } from "@/lib/sheshi";
import { isSaved, onSavedChanged, toggleSaved } from "@/lib/saved";
import { ReportDialog } from "./ReportDialog";
import { ShareDialog, type ShareTarget } from "./ShareDialog";
import { toast } from "sonner";

interface Props {
  message: MessageRow;
  roomSlug: string;
  currentUserId: string | null;
  onChanged?: () => void;
  asThreadLink?: boolean;
  compact?: boolean;
  onReply?: (message: MessageRow) => void;
  // Head-anchored collapse toggle (Reddit's [–]/[+]) — shown when the comment has children.
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function MessageCard({
  message,
  roomSlug,
  currentUserId,
  onChanged,
  asThreadLink = true,
  compact,
  onReply,
  collapsible,
  collapsed,
  onToggleCollapse,
}: Props) {
  const [voting, setVoting] = useState(false);
  const [optimisticUpvotes, setOptimisticUpvotes] = useState(message.upvotes ?? 0);
  const [optimisticVoted, setOptimisticVoted] = useState(!!message.voted);
  const [reportOpen, setReportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [saved, setSaved] = useState(false);
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

  // Saved/bookmark is local-only (localStorage) — keep in sync if another card toggles it.
  useEffect(() => {
    setSaved(isSaved(message.id));
    return onSavedChanged(() => setSaved(isSaved(message.id)));
  }, [message.id]);

  function onToggleSave() {
    const next = toggleSaved(message.id);
    setSaved(next);
    toast.success(next ? sq.chat.saved : sq.chat.unsave);
  }

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

  function buildShareTarget(): ShareTarget {
    const url =
      (typeof window !== "undefined" ? window.location.origin : "") + `/tema/${message.id}`;
    const body = isDeleted ? sq.chat.deleted : message.body.trim();
    const excerpt = body.length > 160 ? `${body.slice(0, 157)}…` : body;
    return {
      title: `#${roomSlug} në ${sq.appName}`,
      text: excerpt || `Diskutim në ${sq.appName}`,
      url,
      roomLabel: `#${roomSlug}`,
    };
  }

  // Prefer the OS share sheet on mobile (the old app's behaviour); fall back to our dialog
  // on desktop / unsupported. A user-cancelled native share is silent, not an error.
  async function onShare() {
    const target = buildShareTarget();
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: target.title, text: target.text, url: target.url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Any other failure → fall through to the dialog.
      }
    }
    setShareOpen(true);
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
    <article
      className={cn(
        "group flex gap-2 rounded-md px-3 py-3 transition-colors hover:bg-card/40 sm:gap-3 sm:px-4",
        compact && "py-2.5",
      )}
    >
      {/* Reddit-style left vote rail: up-arrow over the score. The down-arrow lands when the
          backend gains a real downvote (see docs/plans/2026-06-14-reddit-thread-ui-design.md). */}
      {!isDeleted && (
        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
          <button
            type="button"
            onClick={onVote}
            disabled={voting}
            aria-label={sq.chat.upvote}
            aria-pressed={optimisticVoted}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-sm transition-colors disabled:opacity-50",
              optimisticVoted
                ? "text-primary"
                : "text-foreground/35 hover:bg-primary/10 hover:text-primary",
            )}
          >
            <ArrowBigUp
              className="h-5 w-5"
              fill={optimisticVoted ? "currentColor" : "none"}
              aria-hidden
            />
          </button>
          <span
            className={cn(
              "min-w-5 text-center text-xs font-bold leading-none tabular-nums",
              optimisticVoted ? "text-primary" : "text-foreground/70",
            )}
          >
            {optimisticUpvotes}
          </span>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="mb-1 flex items-center gap-2">
          {collapsible && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? sq.chat.showReplies : sq.chat.hideReplies}
              aria-expanded={!collapsed}
              title={collapsed ? sq.chat.showReplies : sq.chat.hideReplies}
              className="-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-foreground/40 transition-colors hover:bg-background hover:text-primary"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden />
              )}
            </button>
          )}
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/50 bg-card text-[9px] font-bold text-foreground/70"
            aria-hidden
          >
            {message.author?.avatar_url ? (
              <img src={message.author.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span>{initials || "??"}</span>
            )}
          </span>
          <span className="truncate text-sm font-bold">{handle}</span>
          <span className="text-[10px] font-medium tabular-nums text-foreground/30">{time}</span>
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
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
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

            <button
              type="button"
              onClick={() => void onShare()}
              aria-label={sq.share.action}
              title={sq.share.action}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 text-foreground/50 transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden />
            </button>

            <button
              type="button"
              onClick={onToggleSave}
              aria-label={saved ? sq.chat.unsave : sq.chat.save}
              title={saved ? sq.chat.unsave : sq.chat.save}
              aria-pressed={saved}
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                saved
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/70 text-foreground/50 hover:border-primary/60 hover:bg-primary/10 hover:text-primary",
              )}
            >
              <Bookmark className="h-3.5 w-3.5" fill={saved ? "currentColor" : "none"} aria-hidden />
            </button>

            {currentUserId && !isOwn && (
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                aria-label={sq.chat.report}
                title={sq.chat.report}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 text-foreground/50 transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
              >
                <Flag className="h-3.5 w-3.5" />
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={onDelete}
                aria-label={sq.chat.delete}
                title={sq.chat.delete}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 text-foreground/50 transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} messageId={message.id} />
      {shareOpen && (
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} target={buildShareTarget()} />
      )}
    </article>
  );
}
