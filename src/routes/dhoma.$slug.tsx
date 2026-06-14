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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstIdRef = useRef<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const loadingMoreRef = useRef(false);

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
        setCursor(page.next_cursor);
        setNewCount(0);
        firstIdRef.current = firstId;
        requestAnimationFrame(() => {
          if ((loading || isNew) && scrollRef.current)
            scrollRef.current.scrollTo({ top: 0, behavior: loading ? "auto" : "smooth" });
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // Infinite scroll: pull older pages via the cursor API as the user nears the bottom.
  const loadMore = () => {
    if (!room || !cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    listMessages(room.id, cursor)
      .then((page) => {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...page.items.filter((m) => !seen.has(m.id))];
        });
        setCursor(page.next_cursor);
      })
      .catch(() => {})
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 40 && newCount > 0) setNewCount(0);
    if (cursor && el.scrollHeight - el.scrollTop - el.clientHeight < 400) loadMore();
  };

  useEffect(() => {
    if (!room) return;
    const roomId = room.id;
    let disposed = false;
    reload();

    // Super-realtime (Phase 1b): apply typed delta events to local state — no refetch.
    // Other people's posts, votes and deletes appear instantly.
    const onCreated = (p: { message: MessageRow; root_id: string | null }) => {
      const msg = p.message;
      if (!msg || msg.room_id !== roomId) return;
      if (msg.parent_id == null) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
        const el = scrollRef.current;
        if (!el || el.scrollTop < 60) {
          requestAnimationFrame(() => el?.scrollTo({ top: 0, behavior: "smooth" }));
        } else {
          setNewCount((n) => n + 1); // reading below — show a pill instead of yanking the view
        }
      } else if (p.root_id) {
        // a reply: bump its top-level ancestor's reply count in the feed
        setMessages((prev) =>
          prev.map((m) => (m.id === p.root_id ? { ...m, reply_count: (m.reply_count ?? 0) + 1 } : m)));
      }
    };
    const onVote = (p: { message_id: string; score: number }) =>
      setMessages((prev) => prev.map((m) => (m.id === p.message_id ? { ...m, score: p.score } : m)));
    const onDeleted = (p: { id: string }) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === p.id ? { ...m, deleted_at: new Date().toISOString(), body: "", image_url: null } : m)));

    const connectionPromise = ensureRealtimeStarted();
    connectionPromise
      .then((connection) => {
        if (disposed) return;
        connection.on("message_created", onCreated);
        connection.on("vote_changed", onVote);
        connection.on("message_deleted", onDeleted);
        void invokeRealtime("JoinRoom", roomId);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      connectionPromise
        .then((connection) => {
          connection.off("message_created", onCreated);
          connection.off("vote_changed", onVote);
          connection.off("message_deleted", onDeleted);
          void invokeRealtime("LeaveRoom", roomId);
        })
        .catch(() => {});
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
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto no-scrollbar">
          {newCount > 0 && (
            <button
              onClick={() => {
                scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                setNewCount(0);
              }}
              className="sticky top-2 z-10 mx-auto block bg-primary text-primary-foreground text-xs font-bold px-3 py-1.5 rounded-full shadow"
            >
              {newCount === 1 ? "1 postim i ri" : `${newCount} postime të reja`} ↑
            </button>
          )}
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
              {cursor && (
                <div className="p-4 text-center text-[11px] uppercase tracking-widest font-bold text-foreground/40">
                  {loadingMore ? sq.chat.loading : "•"}
                </div>
              )}
            </div>
          )}
        </div>
        {room && <Composer roomId={room.id} currentUserId={userId} onPosted={reload} />}
      </div>
    </AppShell>
  );
}
