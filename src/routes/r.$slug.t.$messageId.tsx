import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { MessageCard } from "@/components/MessageCard";
import { Composer } from "@/components/Composer";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { sq } from "@/i18n/sq";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getMessage, listReplies, listRooms, type MessageRow, type Room } from "@/lib/sheshi";

export const Route = createFileRoute("/r/$slug/t/$messageId")({
  head: () => ({ meta: [{ title: "Tema — Sheshi" }] }),
  component: ThreadPage,
});

function ThreadPage() {
  const { slug, messageId } = Route.useParams();
  const [parent, setParent] = useState<MessageRow | null>(null);
  const [replies, setReplies] = useState<MessageRow[]>([]);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [rooms, setRooms] = useState<Room[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastReplyIdRef = useRef<string | null>(null);

  useEffect(() => {
    listRooms().then(setRooms);
  }, []);

  const reload = () => {
    getMessage(messageId, userId).then(setParent).catch(() => {});
    listReplies(messageId, userId)
      .then((rows) => {
        const lastId = rows[rows.length - 1]?.id ?? null;
        const el = scrollRef.current;
        const wasAtBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 120 : true;
        const isNew = lastId && lastId !== lastReplyIdRef.current;
        setReplies(rows);
        lastReplyIdRef.current = lastId;
        requestAnimationFrame(() => {
          if (el && (wasAtBottom || isNew)) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        });
      })
      .catch(() => {});
  };

  useEffect(() => {
    reload();
    const ch = supabase
      .channel(`thread:${messageId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `parent_id=eq.${messageId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: `message_id=eq.${messageId}` }, reload)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, userId]);

  const roomLookup = useMemo(() => new Map(rooms.map((r) => [r.id, r.slug])), [rooms]);

  return (
    <AppShell right={<HighlightsPanel currentUserId={userId} roomSlugLookup={roomLookup} />}>
      <div className="flex flex-col h-full">
        <div className="h-12 border-b border-border px-6 flex items-center gap-3 shrink-0">
          <Link
            to="/r/$slug"
            params={{ slug }}
            className="text-foreground/50 hover:text-foreground inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> #{slug}
          </Link>
          <span className="text-foreground/20" aria-hidden>/</span>
          <span className="font-display font-bold text-sm uppercase tracking-tight">{sq.chat.thread}</span>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {parent && <MessageCard message={parent} roomSlug={slug} currentUserId={userId} asThreadLink={false} onChanged={reload} />}
          <div className="border-y border-border bg-card/40 px-6 py-2 text-[10px] uppercase tracking-widest font-bold text-foreground/40">
            {sq.chat.replies(replies.length)}
          </div>
          {replies.map((r) => (
            <MessageCard key={r.id} message={r} roomSlug={slug} currentUserId={userId} asThreadLink={false} onChanged={reload} compact />
          ))}
        </div>
        {parent && (
          <Composer
            roomId={parent.room_id}
            parentId={parent.id}
            currentUserId={userId}
            onPosted={reload}
            placeholder={sq.chat.reply + "…"}
          />
        )}
      </div>
    </AppShell>
  );
}
