import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { MessageCard } from "@/components/MessageCard";
import { Composer } from "@/components/Composer";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { sq } from "@/i18n/sq";
import { supabase } from "@/integrations/supabase/client";
import { getMessage, listReplies, listRooms, type MessageRow, type Room } from "@/lib/sheshi";

export const Route = createFileRoute("/r/$slug/t/$messageId")({
  head: () => ({ meta: [{ title: "Tema — Sheshi" }] }),
  component: ThreadPage,
});

function ThreadPage() {
  const { slug, messageId } = Route.useParams();
  const [parent, setParent] = useState<MessageRow | null>(null);
  const [replies, setReplies] = useState<MessageRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUserId(s?.user?.id ?? null));
    listRooms().then(setRooms);
    return () => sub.subscription.unsubscribe();
  }, []);

  const reload = () => {
    getMessage(messageId, userId).then(setParent).catch(() => {});
    listReplies(messageId, userId).then(setReplies).catch(() => {});
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
      <div className="flex flex-col h-[calc(100dvh-3.5rem)]">
        <div className="border-b px-4 py-3 flex items-center gap-2">
          <Link to="/r/$slug" params={{ slug }} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
            <ChevronLeft className="h-4 w-4" /> #{slug}
          </Link>
          <span className="font-semibold ml-2">{sq.chat.thread}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {parent && <MessageCard message={parent} roomSlug={slug} currentUserId={userId} asThreadLink={false} onChanged={reload} />}
          <div className="border-t bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
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
