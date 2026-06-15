import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Flag,
  MessageSquare,
  MoreHorizontal,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { sq as sqLocale } from "date-fns/locale";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";
import { softDeleteMessage, type MessageRow } from "@/lib/sheshi";
import { isSaved, onSavedChanged, toggleSaved } from "@/lib/saved";
import { isReported, onReportedChanged } from "@/lib/reported";
import { VoteControl } from "./VoteControl";
import { ReportDialog } from "./ReportDialog";
import { ShareDialog, type ShareTarget } from "./ShareDialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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
  const [reported, setReported] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const isDeleted = !!message.deleted_at;
  const isOwn = currentUserId && currentUserId === message.author_id;

  const name = message.author?.display_name || message.author?.username || "anonim";
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const time = (() => {
    try {
      return formatDistanceToNowStrict(new Date(message.created_at), {
        locale: sqLocale,
        addSuffix: false,
      });
    } catch {
      return "";
    }
  })();

  useEffect(() => {
    setSaved(isSaved(message.id));
    return onSavedChanged(() => setSaved(isSaved(message.id)));
  }, [message.id]);

  useEffect(() => {
    setReported(isReported(message.id));
    return onReportedChanged(() => setReported(isReported(message.id)));
  }, [message.id]);

  // Close the image lightbox on Escape (click-away also closes it).
  useEffect(() => {
    if (!viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerOpen]);

  function onToggleSave() {
    const next = toggleSaved(message.id);
    setSaved(next);
    toast.success(next ? sq.chat.saved : sq.chat.unsave);
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

  async function confirmDelete() {
    setConfirmDeleteOpen(false);
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
  const opensThread = !isDeleted && (!isTopLevel || (asThreadLink && !onReply));
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
              // Remember which post we opened from, so the room feed can scroll back to it on return.
              if (typeof window !== "undefined")
                window.sessionStorage.setItem(`sheshi:feed-anchor:${roomSlug}`, message.id);
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
          <span className="text-foreground/30">·</span>
          {/* Relative time is "now"-based; when SSR'd it can tick over between server and client render,
              so let React keep the client value without a hydration warning. */}
          <span className="shrink-0 text-foreground/40" suppressHydrationWarning>
            {time}
          </span>
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
          <button
            type="button"
            // Open the image full-screen; stop propagation so it doesn't also open the thread.
            onClick={(e) => {
              e.stopPropagation();
              setViewerOpen(true);
            }}
            className="mt-2.5 block cursor-zoom-in"
            aria-label="Hap imazhin"
          >
            <img
              src={message.image_url}
              alt=""
              className="max-h-96 max-w-full rounded-xl border border-border object-contain"
              loading="lazy"
              // Gracefully hide images whose file is missing (e.g. orphaned older uploads)
              // instead of showing a broken-image icon.
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </button>
        ) : null}
        {!isDeleted && message.video_url ? (
          <video
            src={message.video_url}
            controls
            playsInline
            preload="metadata"
            className="mt-2.5 max-h-96 max-w-full rounded-xl border border-border bg-black"
            // Card-level click opens the thread; don't let video scrubbing trigger navigation.
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}

        {!isDeleted && (
          <div
            className="mt-1.5 flex flex-wrap items-center gap-1"
            onClick={opensThread ? (e) => e.stopPropagation() : undefined}
          >
            <VoteControl message={message} currentUserId={currentUserId} compact={compact} />

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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Më shumë" className={cn(actionBtn, "px-2")}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void onShare()}>
                  <Share2 className="h-4 w-4" aria-hidden /> {sq.share.action}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onToggleSave}>
                  <Bookmark
                    className="h-4 w-4"
                    fill={saved ? "currentColor" : "none"}
                    aria-hidden
                  />
                  {saved ? sq.chat.saved : sq.chat.save}
                </DropdownMenuItem>
                {currentUserId && !isOwn ? (
                  <DropdownMenuItem disabled={reported} onSelect={() => setReportOpen(true)}>
                    <Flag
                      className="h-4 w-4"
                      fill={reported ? "currentColor" : "none"}
                      aria-hidden
                    />
                    {reported ? sq.chat.reported : sq.chat.report}
                  </DropdownMenuItem>
                ) : null}
                {isOwn ? (
                  <DropdownMenuItem
                    onSelect={() => setConfirmDeleteOpen(true)}
                    className="text-primary focus:text-primary"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden /> {sq.chat.delete}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} messageId={message.id} />

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Fshij mesazhin?</DialogTitle>
            <DialogDescription>Ky veprim nuk mund të kthehet.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
              {sq.chat.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              {sq.chat.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {shareOpen && (
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} target={buildShareTarget()} />
      )}

      {viewerOpen && message.image_url ? (
        // Full-screen image viewer. Click anywhere (or Escape, or the ×) closes it.
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            e.stopPropagation();
            setViewerOpen(false);
          }}
        >
          <img src={message.image_url} alt="" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewerOpen(false);
            }}
            aria-label="Mbyll"
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : null}
    </article>
  );
}
