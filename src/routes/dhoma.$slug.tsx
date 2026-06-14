import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
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
  // Chat mode (newest at the bottom): pending scroll-to-bottom, and the pre-prepend height used to
  // anchor the viewport when older messages load in at the top.
  const scrollToBottomRef = useRef(false);
  const olderAdjustRef = useRef<number | null>(null);
  // Restore the reader's scroll position when they come back to this room (e.g. after opening a
  // thread from the middle of the feed) instead of force-scrolling to the bottom. Persisted per
  // room in sessionStorage and consumed once, on the initial load.
  const restoreScrollRef = useRef<number | null>(null);
  // The exact post the reader opened a thread from — scroll it back into view on return (more
  // reliable than a raw scroll offset once images/videos reflow). Falls back to the saved offset.
  const anchorRef = useRef<string | null>(null);
  const scrollKey = `sheshi:feed-scroll:${slug}`;
  const anchorKey = `sheshi:feed-anchor:${slug}`;

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
        // Chat mode: land on the latest message (bottom) on first load or when the newest changed
        // (e.g. right after you post). Applied in the layout effect once the list has rendered.
        // Exception: on the very first load, prefer scrolling back to the exact post the reader
        // opened a thread from; else fall back to the saved scroll offset; else jump to bottom.
        const anchor = loading && typeof window !== "undefined" ? window.sessionStorage.getItem(anchorKey) : null;
        const saved = loading && typeof window !== "undefined" ? window.sessionStorage.getItem(scrollKey) : null;
        if (anchor && rows.some((m) => m.id === anchor)) {
          anchorRef.current = anchor;
          window.sessionStorage.removeItem(anchorKey); // consume once
        } else if (saved !== null) {
          restoreScrollRef.current = Number(saved);
        } else {
          scrollToBottomRef.current = Boolean(loading || isNew);
        }
        // FEED MODE (newest at top) — kept for later:
        // requestAnimationFrame(() => {
        //   if ((loading || isNew) && scrollRef.current)
        //     scrollRef.current.scrollTo({ top: 0, behavior: loading ? "auto" : "smooth" });
        // });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // Infinite scroll: pull older pages via the cursor API. Chat mode: older messages render at the
  // TOP, so we capture the scroll height first and re-anchor in the layout effect (no jump).
  const loadMore = () => {
    if (!room || !cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    olderAdjustRef.current = scrollRef.current?.scrollHeight ?? null;
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
    // Chat mode: you're "caught up" near the BOTTOM; older history loads when you scroll near the TOP.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40 && newCount > 0) setNewCount(0);
    if (cursor && el.scrollTop < 400) loadMore();
    // Remember where the reader is, so returning to this room (after opening a thread) lands here.
    try {
      window.sessionStorage.setItem(scrollKey, String(el.scrollTop));
    } catch {
      // sessionStorage disabled — restore is best-effort.
    }
    // FEED MODE — kept for later:
    // if (el.scrollTop < 40 && newCount > 0) setNewCount(0);
    // if (cursor && el.scrollHeight - el.scrollTop - el.clientHeight < 400) loadMore();
  };

  // Apply pending scroll adjustments after the message list re-renders.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (olderAdjustRef.current != null) {
      el.scrollTop += el.scrollHeight - olderAdjustRef.current; // keep older-load from jumping the view
      olderAdjustRef.current = null;
      return;
    }
    if (anchorRef.current != null) {
      const target = el.querySelector<HTMLElement>(`[data-mid="${anchorRef.current}"]`);
      anchorRef.current = null;
      if (target) {
        target.scrollIntoView({ block: "center" });
        return;
      }
    }
    if (restoreScrollRef.current != null) {
      // Clamp in case the feed is now shorter than when we left.
      el.scrollTop = Math.min(restoreScrollRef.current, el.scrollHeight);
      restoreScrollRef.current = null;
      return;
    }
    if (scrollToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      scrollToBottomRef.current = false;
    }
  }, [messages]);

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
        // Chat mode: a new message lands at the bottom — follow it if you're already near the bottom,
        // otherwise show the "new messages ↓" pill instead of yanking the view.
        const el = scrollRef.current;
        const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (nearBottom) scrollToBottomRef.current = true;
        else setNewCount((n) => n + 1);
        // FEED MODE — kept for later:
        // if (!el || el.scrollTop < 60) requestAnimationFrame(() => el?.scrollTo({ top: 0, behavior: "smooth" }));
        // else setNewCount((n) => n + 1);
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
        prev.map((m) => (m.id === p.id ? { ...m, deleted_at: new Date().toISOString(), body: "", image_url: null, video_url: null } : m)));

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
        <div className="relative flex-1 min-h-0">
          <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto no-scrollbar">
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
              // Chat-style stream (newest at the bottom): older history at the top, latest at the
              // bottom — dense compact messages, each still votable and clickable to its thread.
              <div className="flex flex-col divide-y divide-border/40 py-1">
                {cursor && (
                  <div className="p-4 text-center text-[11px] uppercase tracking-widest font-bold text-foreground/40">
                    {loadingMore ? sq.chat.loading : "•"}
                  </div>
                )}
                {/* data is newest-first; reverse for display so the latest renders at the bottom.
                    FEED MODE (newest at top) — kept for later: {messages.map((m) => …)} */}
                {messages
                  .slice()
                  .reverse()
                  .map((m) => (
                    <div key={m.id} data-mid={m.id}>
                      <MessageCard
                        message={m}
                        roomSlug={slug}
                        currentUserId={userId}
                        onChanged={reload}
                        compact
                      />
                    </div>
                  ))}
              </div>
            )}
          </div>
          {newCount > 0 && (
            <button
              onClick={() => {
                const el = scrollRef.current;
                if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                setNewCount(0);
              }}
              className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1.5 rounded-full shadow"
            >
              {newCount === 1 ? "1 postim i ri" : `${newCount} postime të reja`} ↓
            </button>
          )}
        </div>
        {room && <Composer roomId={room.id} currentUserId={userId} onPosted={reload} />}
      </div>
    </AppShell>
  );
}
