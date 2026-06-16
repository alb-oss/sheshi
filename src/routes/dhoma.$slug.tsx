import { createFileRoute } from "@tanstack/react-router";
import {
  useInfiniteQuery,
  useIsRestoring,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { MessageCard } from "@/components/MessageCard";
import { Composer } from "@/components/Composer";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { sq } from "@/i18n/sq";
import { useAuth } from "@/hooks/use-auth";
import { getRoomBySlug, listMessages, type CursorPage, type MessageRow } from "@/lib/sheshi";
import { useRooms } from "@/hooks/use-rooms";
import { MessageListSkeleton } from "@/components/Skeletons";
import { ensureRealtimeStarted, invokeRealtime } from "@/lib/realtime";
import { useRealtimeResync } from "@/hooks/use-realtime-resync";

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

type FeedData = InfiniteData<CursorPage<MessageRow>, string | null>;

function RoomRoute() {
  const { slug } = Route.useParams();
  return <RoomPage slug={slug} />;
}

function RoomPage({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const { data: rooms = [] } = useRooms();
  // The room is seeded instantly from the persisted rooms list when available; getRoomBySlug only
  // backstops a cold deep-link before that list has loaded.
  const roomQuery = useQuery({
    queryKey: ["room", slug],
    queryFn: () => getRoomBySlug(slug),
    initialData: () => rooms.find((r) => r.slug === slug),
    staleTime: 60_000,
  });
  const room = roomQuery.data ?? null;
  const roomId = room?.id ?? null;

  const { user } = useAuth();
  const userId = user?.id ?? null;

  // The feed is the source of truth in the React Query cache (persisted), so re-entering a room — or
  // a hard refresh — renders the last-seen messages instantly, then revalidates quietly. page[0] holds
  // the newest 40 (newest-first); fetchNextPage pulls older history onto the tail.
  const messagesKey = useMemo(() => ["messages", roomId] as const, [roomId]);
  const q = useInfiniteQuery({
    queryKey: messagesKey,
    queryFn: ({ pageParam }) => listMessages(roomId!, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!roomId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const messages = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  // Re-converge the feed to server truth after a reconnect or tab-foreground (missed deltas).
  useRealtimeResync(() => {
    if (roomId) void queryClient.invalidateQueries({ queryKey: ["messages", roomId] });
  });
  // The room header is seeded synchronously from the persisted rooms list (initialData) and the feed
  // from the persisted ["messages", roomId] query, so keep the skeleton on the server and the first
  // client render until the cache restores — otherwise the body pops restored content and React 19
  // reports a hydration mismatch.
  const isRestoring = useIsRestoring();
  const loading = isRestoring || roomQuery.isPending || (!!roomId && q.isPending);

  const [newCount, setNewCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Chat mode (newest at the bottom). Scroll intents applied after the cache changes (layout effect):
  const scrollToBottomRef = useRef(false);
  // One-time initial placement per room: feed-anchor (the exact post you opened a thread from) → saved
  // offset → bottom. Gated by a ref because the cache can hydrate instantly (q.isPending is no longer
  // the "first paint" signal).
  const didInitialScrollRef = useRef(false);
  const scrollKey = `sheshi:feed-scroll:${slug}`;
  const anchorKey = `sheshi:feed-anchor:${slug}`;

  // Reset per-room scroll bookkeeping when switching rooms (same component instance).
  useEffect(() => {
    didInitialScrollRef.current = false;
    scrollToBottomRef.current = false;
    setNewCount(0);
  }, [roomId]);

  // Infinite scroll: pull older pages via the cursor API. Chat mode: older messages render at the TOP,
  // so capture scrollHeight before fetching and re-anchor scrollTop after paint (no jump). Decoupled
  // from the shared layout effect so a concurrent realtime patch can't consume the anchor early.
  const loadMore = async () => {
    if (!roomId || !q.hasNextPage || q.isFetchingNextPage) return;
    const el = scrollRef.current;
    const before = el?.scrollHeight ?? 0;
    await q.fetchNextPage();
    requestAnimationFrame(() => {
      const el2 = scrollRef.current;
      if (el2) el2.scrollTop += el2.scrollHeight - before;
    });
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Chat mode: you're "caught up" near the BOTTOM; older history loads when you scroll near the TOP.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40 && newCount > 0) setNewCount(0);
    if (q.hasNextPage && el.scrollTop < 400) void loadMore();
    // Remember where the reader is, so returning to this room (after opening a thread) lands here.
    try {
      window.sessionStorage.setItem(scrollKey, String(el.scrollTop));
    } catch {
      // sessionStorage disabled — restore is best-effort.
    }
  };

  // Apply scroll placement after the message list renders.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;

    // One-time initial placement for this room: exact feed-anchor → saved offset → bottom.
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      const anchor =
        typeof window !== "undefined" ? window.sessionStorage.getItem(anchorKey) : null;
      const saved = typeof window !== "undefined" ? window.sessionStorage.getItem(scrollKey) : null;
      if (anchor && messages.some((m) => m.id === anchor)) {
        window.sessionStorage.removeItem(anchorKey); // consume once
        // Re-center across a short window: the first scroll lands before media above the target finish
        // loading, which reflows the list and drifts the post away (it can end up near the bottom).
        // Re-assert as the layout settles so we land on the EXACT post the reader opened.
        let frame = 0;
        const recenter = () => {
          el.querySelector<HTMLElement>(`[data-mid="${anchor}"]`)?.scrollIntoView({
            block: "center",
          });
          if (frame++ < 10) requestAnimationFrame(recenter);
        };
        recenter();
        window.setTimeout(recenter, 300);
        return;
      }
      if (saved !== null) {
        // Clamp in case the feed is now shorter than when we left.
        el.scrollTop = Math.min(Number(saved), el.scrollHeight);
        return;
      }
      el.scrollTop = el.scrollHeight; // default: land at the latest (bottom)
      return;
    }

    if (scrollToBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      scrollToBottomRef.current = false;
    }
  }, [messages, anchorKey, scrollKey]);

  // Super-realtime: apply typed delta events to the feed cache — no refetch. Other people's posts,
  // votes and deletes appear instantly.
  useEffect(() => {
    if (!roomId) return;
    const key = ["messages", roomId] as const;
    let disposed = false;
    const read = () => queryClient.getQueryData<FeedData>(key);
    const write = (next: FeedData) => queryClient.setQueryData<FeedData>(key, next);
    const blank = (m: MessageRow): MessageRow => ({
      ...m,
      deleted_at: new Date().toISOString(),
      body: "",
      image_url: null,
      video_url: null,
    });

    const onCreated = (p: { message: MessageRow; root_id: string | null }) => {
      const msg = p.message;
      if (!msg || msg.room_id !== roomId) return;
      const d = read();
      if (!d || !d.pages[0]) return;
      if (msg.parent_id == null) {
        if (d.pages.some((pg) => pg.items.some((m) => m.id === msg.id))) return; // dedup
        // Chat mode: a new message lands at the bottom — follow it if you're already near the bottom,
        // otherwise show the "new messages ↓" pill instead of yanking the view. Measure BEFORE patch.
        const el = scrollRef.current;
        const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        write({
          ...d,
          pages: [{ ...d.pages[0], items: [msg, ...d.pages[0].items] }, ...d.pages.slice(1)],
        });
        if (nearBottom) scrollToBottomRef.current = true;
        else setNewCount((n) => n + 1);
      } else if (p.root_id) {
        // a reply: bump its top-level ancestor's reply count in the feed
        write({
          ...d,
          pages: d.pages.map((pg) => ({
            ...pg,
            items: pg.items.map((m) =>
              m.id === p.root_id ? { ...m, reply_count: (m.reply_count ?? 0) + 1 } : m,
            ),
          })),
        });
      }
    };
    const onVote = (p: { message_id: string; score: number }) => {
      const d = read();
      if (!d) return;
      write({
        ...d,
        pages: d.pages.map((pg) => ({
          ...pg,
          items: pg.items.map((m) => (m.id === p.message_id ? { ...m, score: p.score } : m)),
        })),
      });
    };
    const onDeleted = (p: { id: string }) => {
      const d = read();
      if (!d) return;
      write({
        ...d,
        pages: d.pages.map((pg) => ({
          ...pg,
          items: pg.items.map((m) => (m.id === p.id ? blank(m) : m)),
        })),
      });
    };
    // The caller's OWN vote, pushed only to their connections — syncs the vote colour (my_vote) across
    // this user's other devices/tabs. The public vote_changed echo only moves the score.
    const onMyVote = (p: { message_id: string; value: number }) => {
      const d = read();
      if (!d) return;
      write({
        ...d,
        pages: d.pages.map((pg) => ({
          ...pg,
          items: pg.items.map((m) => (m.id === p.message_id ? { ...m, my_vote: p.value } : m)),
        })),
      });
    };

    const connectionPromise = ensureRealtimeStarted();
    connectionPromise
      .then((connection) => {
        if (disposed) return;
        connection.on("message_created", onCreated);
        connection.on("vote_changed", onVote);
        connection.on("my_vote_changed", onMyVote);
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
          connection.off("my_vote_changed", onMyVote);
          connection.off("message_deleted", onDeleted);
          void invokeRealtime("LeaveRoom", roomId);
        })
        .catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId]);

  const onChanged = () => void queryClient.invalidateQueries({ queryKey: messagesKey });
  const onPosted = () => {
    scrollToBottomRef.current = true;
    void queryClient.invalidateQueries({ queryKey: messagesKey });
  };

  const roomLookup = useMemo(() => new Map(rooms.map((r) => [r.id, r.slug])), [rooms]);

  return (
    <AppShell right={<HighlightsPanel currentUserId={userId} roomSlugLookup={roomLookup} />}>
      <div className="flex flex-col h-full">
        <div className="h-12 px-6 flex items-center justify-between border-b border-border shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            {/* The room name/description come from the PERSISTED rooms cache (via initialData), so render
                the "…" placeholder until restore completes — otherwise the header text differs from the
                SSR HTML and React 19 reports a hydration mismatch. */}
            <h2 className="font-display font-bold text-lg truncate">
              {isRestoring ? "…" : (room?.name ?? "…")}
              {!isRestoring && room?.description && (
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
            {isRestoring ? 0 : messages.length} {sq.chat.messagesCount}
          </span>
        </div>
        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="absolute inset-0 overflow-y-auto no-scrollbar"
          >
            {loading ? (
              <MessageListSkeleton compact />
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
                {q.hasNextPage && (
                  <div className="p-4 text-center text-[11px] uppercase tracking-widest font-bold text-foreground/40">
                    {q.isFetchingNextPage ? sq.chat.loading : "•"}
                  </div>
                )}
                {/* data is newest-first; reverse for display so the latest renders at the bottom. */}
                {messages
                  .slice()
                  .reverse()
                  .map((m) => (
                    <div key={m.id} data-mid={m.id}>
                      <MessageCard
                        message={m}
                        roomSlug={slug}
                        currentUserId={userId}
                        onChanged={onChanged}
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
        {!isRestoring && room && (
          <Composer roomId={room.id} currentUserId={userId} onPosted={onPosted} />
        )}
      </div>
    </AppShell>
  );
}
