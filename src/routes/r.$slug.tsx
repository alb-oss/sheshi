import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { MessageCard } from "@/components/MessageCard";
import { Composer } from "@/components/Composer";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { sq } from "@/i18n/sq";
import { supabase } from "@/integrations/supabase/client";
import { getRoomBySlug, listMessages, listRooms, type MessageRow, type Room } from "@/lib/sheshi";

export const Route = createFileRoute("/r/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `#${params.slug} — Sheshi` },
      { name: "description", content: `Diskutim qytetar drejtpërdrejt në dhomën #${params.slug}.` },
      { property: "og:title", content: `#${params.slug} — Sheshi` },
      { property: "og:description", content: `Diskutim qytetar drejtpërdrejt në dhomën #${params.slug}.` },
    ],
  }),
  component: RoomPage,
});

function RoomPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    listRooms().then(setRooms).catch(() => {});
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRoomBySlug(slug).then((r) => {
      if (cancelled) return;
      if (!r) { navigate({ to: "/r/$slug", params: { slug: "sheshi" } }); return; }
      setRoom(r);
    });
    return () => { cancelled = true; };
  }, [slug, navigate]);

  const reload = () => {
    if (!room) return;
    listMessages(room.id, userId).then(setMessages).catch(() => {}).finally(() => setLoading(false));
  };

  // schedule a debounced reload so realtime spam doesn't trigger fetch storm
  const scheduleReload = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(reload, 300);
  };

  useEffect(() => {
    if (!room) return;
    reload();
    const channel = supabase
      .channel(`room:${room.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, scheduleReload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, userId]);

  const roomLookup = useMemo(() => new Map(rooms.map((r) => [r.id, r.slug])), [rooms]);

  return (
    <AppShell right={<HighlightsPanel currentUserId={userId} roomSlugLookup={roomLookup} />}>
      <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-3.5rem)]">
        <div className="border-b px-4 py-3">
          <h1 className="font-bold text-lg">{room?.name ?? "…"}</h1>
          {room?.description && <p className="text-sm text-muted-foreground">{room.description}</p>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">{sq.chat.loading}</div>
          ) : messages.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">{sq.chat.empty}</div>
          ) : (
            messages.map((m) => (
              <MessageCard
                key={m.id}
                message={m}
                roomSlug={slug}
                currentUserId={userId}
                onChanged={reload}
              />
            ))
          )}
        </div>
        {room && <Composer roomId={room.id} currentUserId={userId} onPosted={reload} />}
      </div>
    </AppShell>
  );
}
