import { Link } from "@tanstack/react-router";
import { ArrowBigUp, MessageSquare, Flag, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { sq as sqLocale } from "date-fns/locale";
import { sq } from "@/i18n/sq";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
}

export function MessageCard({ message, roomSlug, currentUserId, onChanged, asThreadLink = true, compact }: Props) {
  const [voting, setVoting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const isDeleted = !!message.deleted_at;
  const isOwn = currentUserId && currentUserId === message.author_id;

  const name = message.author?.display_name || message.author?.username || "Anonim";
  const initial = name.slice(0, 1).toUpperCase();
  const time = (() => {
    try { return formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: sqLocale }); }
    catch { return ""; }
  })();

  async function onVote() {
    if (!currentUserId) { toast.error(sq.chat.signInToPost); return; }
    setVoting(true);
    try {
      await toggleVote(message.id, !!message.voted);
      onChanged?.();
    } catch (e) {
      toast.error(sq.errors.generic);
    } finally {
      setVoting(false);
    }
  }

  async function onDelete() {
    if (!confirm("Fshij këtë mesazh?")) return;
    try { await softDeleteMessage(message.id); onChanged?.(); }
    catch { toast.error(sq.errors.generic); }
  }

  return (
    <article className={cn("group flex gap-3 px-4 py-3 border-b", compact && "py-2")}>
      <Avatar className="h-9 w-9 shrink-0">
        {message.author?.avatar_url && <AvatarImage src={message.author.avatar_url} alt={name} />}
        <AvatarFallback className="bg-accent text-accent-foreground text-sm">{initial}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-semibold truncate">{name}</span>
          <span className="text-muted-foreground text-xs">{time}</span>
        </div>
        <div className={cn("mt-1 whitespace-pre-wrap break-words text-[15px] leading-snug", isDeleted && "italic text-muted-foreground")}>
          {isDeleted ? sq.chat.deleted : message.body}
        </div>
        {!isDeleted && (
          <div className="mt-2 flex items-center gap-1 text-muted-foreground">
            <Button
              variant={message.voted ? "default" : "ghost"}
              size="sm"
              className="h-8 gap-1.5 px-2"
              onClick={onVote}
              disabled={voting}
              aria-label={sq.chat.upvote}
            >
              <ArrowBigUp className="h-4 w-4" />
              <span className="text-xs tabular-nums">{message.upvotes ?? 0}</span>
            </Button>
            {message.parent_id === null && asThreadLink && (
              <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2">
                <Link to="/r/$slug/t/$messageId" params={{ slug: roomSlug, messageId: message.id }}>
                  <MessageSquare className="h-4 w-4" />
                  <span className="text-xs tabular-nums">{message.reply_count ?? 0}</span>
                </Link>
              </Button>
            )}
            {currentUserId && (
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setReportOpen(true)} aria-label={sq.chat.report}>
                <Flag className="h-3.5 w-3.5" />
              </Button>
            )}
            {isOwn && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive" onClick={onDelete} aria-label={sq.chat.delete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} messageId={message.id} />
    </article>
  );
}
