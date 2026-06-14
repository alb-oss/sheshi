import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Flag,
  MessageSquare,
  Share2,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { sq as sqLocale } from "date-fns/locale";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";
import { softDeleteMessage, type MessageRow } from "@/lib/sheshi";
import { isSaved, onSavedChanged, toggleSaved } from "@/lib/saved";
import { VoteControl } from "./VoteControl";
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
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const actionBtn =
  "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-foreground/55 transition-colors hover:bg-secondary hover:text-foreground";

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
  const navigate = useNavigate();
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
      return formatDistanceToNowStrict(new Date(message.created_at), { locale: sqLocale, addSuffix: false });
    } catch {
      return "";
    }
  })();

  useEffect(() => {
    setSaved(isSaved(message.id));
    return onSavedChanged(() => setSaved(isSaved(message.id)));
  }, [message.id]);

  function onToggleSave() {
    const next = toggleSaved(message.id);
    setSaved(next);
    toast.success(next ? sq.chat.saved : sq.chat.unsave);
  }

  function buildShareTarget(): ShareTarget {
    const url = (typeof window !== "undefined" ? window.location.origin : "") + `/tema/${message.id}`;
    const body = isDeleted ? sq.chat.deleted : message.body.trim();
    const excerpt = body.length > 160 ? `${body.slice(0, 157)}…` : body;
    return {
      title: `#${roomSlug} në ${sq.appName}`,
      text: excerpt || `Diskutim në ${sq.appName}`,
      url,
      roomLabel: `#${roomSlug}`,
    };
  }

  async function onShare() {
    const target = buildShareTarget();
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: target.title, text: target.text, url: target.url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
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

  const avatar = (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary font-bold text-foreground/70",
        compact ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs",
      )}
      aria-hidden
    >
      {message.author?.avatar_url ? (
        <img src={message.author.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span>{initials || "??"}</span>
      )}
    </span>
  );

  const isTopLevel = message.parent_id === null;
  // The whole card opens its own detail page (/tema/:id renders ANY message — post or reply —
  // as a thread root). True for feed posts AND for replies inside a thread (so you can drill
  // into a reply's own page); false only for the root you're already viewing. The action row
  // stops propagation so its buttons still work.
  const opensThread =
    !isDeleted && (!isTopLevel || (asThreadLink && !onReply));
  const replyInner = (
    <>
      <MessageSquare className="h-4 w-4" aria-hidden />
      {isTopLevel && message.reply_count ? (
        <span>{message.reply_count}</span>
      ) : (
        <span className="hidden sm:inline">{sq.chat.reply}</span>
      )}
    </>
  );

  return (
    <article
      className={cn(
        "group flex gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-card/50 sm:px-4",
        opensThread && "cursor-pointer",
      )}
      onClick={
        opensThread
          ? () => {
              // Don't hijack a click that was actually a text selection.
              if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
              navigate({ to: "/tema/$messageId", params: { messageId: message.id } });
            }
          : undefined
      }
    >
      {avatar}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          {collapsible && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.();
              }}
              aria-label={collapsed ? sq.chat.showReplies : sq.chat.hideReplies}
              aria-expanded={!collapsed}
              title={collapsed ? sq.chat.showReplies : sq.chat.hideReplies}
              className="-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-secondary hover:text-foreground"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden />
              )}
            </button>
          )}
          <span className="truncate font-bold">{name}</span>
          <span className="truncate text-foreground/40">{handle}</span>
          <span className="text-foreground/30">·</span>
          <span className="shrink-0 text-foreground/40">{time}</span>
        </div>

        <div
          className={cn(
            "mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed",
            isDeleted ? "italic text-foreground/40" : "text-foreground/90",
          )}
        >
          {isDeleted ? sq.chat.deleted : message.body}
        </div>
        {!isDeleted && message.image_url ? (
          <img
            src={message.image_url}
            alt=""
            className="mt-2.5 max-h-96 max-w-full rounded-xl border border-border object-contain"
            loading="lazy"
            // Gracefully hide images whose file is missing (e.g. orphaned older uploads)
            // instead of showing a broken-image icon.
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}

        {!isDeleted && (
          <div
            className="mt-1.5 flex flex-wrap items-center gap-1"
            onClick={opensThread ? (e) => e.stopPropagation() : undefined}
          >
            <VoteControl message={message} currentUserId={currentUserId} onChanged={onChanged} compact={compact} />

            {onReply ? (
              <button type="button" onClick={() => onReply(message)} className={actionBtn}>
                {replyInner}
              </button>
            ) : isTopLevel && asThreadLink ? (
              <Link
                to="/tema/$messageId"
                params={{ messageId: message.id }}
                onClick={() => {
                  if (typeof window !== "undefined")
                    window.sessionStorage.setItem("sheshi:reply-intent", message.id);
                }}
                className={actionBtn}
              >
                {replyInner}
              </Link>
            ) : null}

            <button type="button" onClick={() => void onShare()} aria-label={sq.share.action} className={actionBtn}>
              <Share2 className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{sq.share.action}</span>
            </button>

            <button
              type="button"
              onClick={onToggleSave}
              aria-label={saved ? sq.chat.unsave : sq.chat.save}
              aria-pressed={saved}
              className={cn(actionBtn, saved && "text-primary hover:text-primary")}
            >
              <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} aria-hidden />
              <span className="hidden sm:inline">{saved ? sq.chat.saved : sq.chat.save}</span>
            </button>

            {currentUserId && (
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                aria-label={sq.chat.report}
                title={sq.chat.report}
                className={cn(actionBtn, "px-2")}
              >
                <Flag className="h-4 w-4" aria-hidden />
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={onDelete}
                aria-label={sq.chat.delete}
                title={sq.chat.delete}
                className={cn(actionBtn, "px-2 hover:text-primary")}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
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
