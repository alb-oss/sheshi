import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { MessageCard } from "@/components/MessageCard";
import { Composer } from "@/components/Composer";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { sq } from "@/i18n/sq";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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
  component: RoomRoute,
});

function RoomRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.includes("/t/")) return <Outlet />;
  return <RoomPage />;
}

function RoomPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastIdRef = useRef<string | null>(null);

  const scrollToBottom = (smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    listRooms().then(setRooms).catch(() => {});
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
    listMessages(room.id, userId)
      .then((rows) => {
        const lastId = rows[rows.length - 1]?.id ?? null;
        const wasAtBottom = (() => {
          const el = scrollRef.current;
          if (!el) return true;
          return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        })();
        const isNew = lastId && lastId !== lastIdRef.current;
        setMessages(rows);
        lastIdRef.current = lastId;
        // Always scroll on first load; otherwise scroll if user was near bottom
        requestAnimationFrame(() => {
          if (loading || wasAtBottom || isNew) scrollToBottom(!loading);
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
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
      <div className="flex flex-col h-full">
        <div className="h-12 px-6 flex items-center justify-between border-b border-border shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <h2 className="font-display font-bold text-lg truncate">
              {room?.name ?? "…"}
              {room?.description && (
                <>
                  <span className="text-sm font-normal text-foreground/40 mx-2">—</span>
                  <span className="text-sm font-normal text-foreground/70">{room.description}</span>
                </>
              )}
            </h2>
            <div className="hidden sm:flex items-center gap-2 bg-primary/10 px-2 py-0.5 rounded shrink-0">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden />
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
                Live
              </span>
            </div>
          </div>
          <span className="hidden sm:block text-xs text-foreground/40 font-medium tabular-nums">
            {messages.length} {sq.chat.messagesCount}
          </span>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="p-6 text-xs uppercase tracking-widest font-bold text-foreground/40">
              {sq.chat.loading}
            </div>
          ) : messages.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-xs uppercase tracking-widest font-bold text-foreground/40 mb-2">
                Sheshi është bosh
              </div>
              <div className="text-sm text-foreground/60">{sq.chat.empty}</div>
            </div>
          ) : (
            <div className="py-2">
              {messages.map((m) => (
                <MessageCard
                  key={m.id}
                  message={m}
                  roomSlug={slug}
                  currentUserId={userId}
                  onChanged={reload}
                />
              ))}
            </div>
          )}
        </div>
        {room && <Composer roomId={room.id} currentUserId={userId} onPosted={reload} />}
      </div>
    </AppShell>
  );
}
