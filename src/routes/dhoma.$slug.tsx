import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { MessageCard } from "@/components/MessageCard";
import { Composer } from "@/components/Composer";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { sq } from "@/i18n/sq";
import { useAuth } from "@/hooks/use-auth";
import { getRoomBySlug, listMessages, listRooms, type MessageRow, type Room } from "@/lib/sheshi";
import { ensureRealtimeStarted, invokeRealtime } from "@/lib/realtime";

export const Route = createFileRoute("/dhoma/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `#${params.slug} — Sheshi` },
      { name: "description", content: `Diskutim qytetar drejtpërdrejt në dhomën #${params.slug}.` },
      { property: "og:title", content: `#${params.slug} — Sheshi` },
      {
        property: "og:description",
        content: `Diskutim qytetar drejtpërdrejt në dhomën #${params.slug}.`,
      },
    ],
  }),
  component: RoomRoute,
});

function RoomRoute() {
  const { slug } = Route.useParams();
  return <RoomPage slug={slug} />;
}

function RoomPage({ slug }: { slug: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstIdRef = useRef<string | null>(null);

  useEffect(() => {
    listRooms()
      .then(setRooms)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRoomBySlug(slug).then((r) => {
      if (cancelled) return;
      if (!r) {
        setRoom(null);
        setMessages([]);
        setLoading(false);
        return;
      }
      setRoom(r);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const reload = () => {
    if (!room) return;
    listMessages(room.id)
      .then((page) => {
        const rows = page.items;
        const firstId = rows[0]?.id ?? null;
        const isNew = firstId && firstId !== firstIdRef.current;
        setMessages(rows);
        firstIdRef.current = firstId;
        requestAnimationFrame(() => {
          if ((loading || isNew) && scrollRef.current)
            scrollRef.current.scrollTo({ top: 0, behavior: loading ? "auto" : "smooth" });
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
    let disposed = false;
    let handler: (() => void) | null = null;
    reload();
    const connectionPromise = ensureRealtimeStarted();
    connectionPromise
      .then((connection) => {
        if (disposed) return;
        handler = scheduleReload;
        connection.on("changed", handler);
        void invokeRealtime("JoinRoom", room.id);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      connectionPromise
        .then((connection) => {
          if (handler) connection.off("changed", handler);
          void invokeRealtime("LeaveRoom", room.id);
        })
        .catch(() => {});
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
