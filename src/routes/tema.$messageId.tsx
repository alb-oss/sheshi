import { createFileRoute, Link } from "@tanstack/react-router";
import { useIsRestoring, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Composer, type ComposerHandle } from "@/components/Composer";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { MessageCard } from "@/components/MessageCard";
import { sq } from "@/i18n/sq";
import { useAuth } from "@/hooks/use-auth";
import { getThread, type MessageRow, type ReplyNode, type ThreadData } from "@/lib/sheshi";
import { useRooms } from "@/hooks/use-rooms";
import { ThreadSkeleton } from "@/components/Skeletons";
import { ensureRealtimeStarted, invokeRealtime } from "@/lib/realtime";
import { useRealtimeResync } from "@/hooks/use-realtime-resync";

// Server-render the thread so crawlers + link unfurls see the real discussion, and seed the query
// cache from it (initialData) so the client renders identical markup — no hydration mismatch, no
// double-fetch. getThread hits a public endpoint; it runs anonymously on the server and authed on
// client navigation.
export const Route = createFileRoute("/tema/$messageId")({
  loader: ({ params }) => getThread(params.messageId).then((thread) => ({ thread })),
  head: ({ loaderData }) => buildThreadHead(loaderData?.thread ?? null),
  component: ThreadPage,
});

function buildThreadHead(thread: ThreadData | null) {
  const root = thread?.root;
  const text = root && !root.deleted_at ? root.body.trim() : "";
  if (!text) return { meta: [{ title: "Tema — Sheshi" }] };
  const title = `${text.length > 60 ? `${text.slice(0, 60)}…` : text} — Sheshi`;
  const description = text.length > 160 ? `${text.slice(0, 157)}…` : text;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "article" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
  };
}

type ReplyTarget = {
  messageId: string;
  label: string;
  excerpt?: string;
};

// Pure, immutable tree updates for super-realtime delta-apply (Phase A).
function updateNode(
  nodes: ReplyNode[],
  id: string,
  fn: (m: MessageRow) => MessageRow,
): ReplyNode[] {
  return nodes.map((n) =>
    n.message.id === id
      ? { ...n, message: fn(n.message) }
      : { ...n, replies: updateNode(n.replies, id, fn) },
  );
}
function hasNode(nodes: ReplyNode[], id: string): boolean {
  return nodes.some((n) => n.message.id === id || hasNode(n.replies, id));
}
function insertUnderParent(
  nodes: ReplyNode[],
  parentId: string,
  msg: MessageRow,
): { nodes: ReplyNode[]; inserted: boolean } {
  let inserted = false;
  const out = nodes.map((n) => {
    if (n.message.id === parentId) {
      inserted = true;
      return { ...n, replies: [...n.replies, { message: msg, replies: [], depth: n.depth + 1 }] };
    }
    const r = insertUnderParent(n.replies, parentId, msg);
    if (r.inserted) inserted = true;
    return { ...n, replies: r.nodes };
  });
  return { nodes: out, inserted };
}

function ThreadPage() {
  const { messageId } = Route.useParams();
  const { thread: loaderThread } = Route.useLoaderData();
  const queryClient = useQueryClient();
  // The thread tree lives in the React Query cache (in-memory only — threads aren't persisted). It's
  // seeded from the route loader (initialData) so the server and first client render are identical
  // (SSR'd content, no hydration mismatch); realtime events patch this cache via setQueryData.
  const { data: thread = null, isPending: loading } = useQuery({
    queryKey: ["thread", messageId],
    queryFn: () => getThread(messageId),
    initialData: loaderThread ?? undefined,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const { data: rooms = [] } = useRooms();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastReplyIdRef = useRef<string | null>(null);
  // Scroll intent applied after the cache changes (see the layout effect): first load, your own reply,
  // and a realtime reply that lands while you're already near the bottom all scroll you to the bottom.
  const scrollToBottomRef = useRef(false);
  const hadDataRef = useRef(false);
  const composerRef = useRef<ComposerHandle | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);

  const invalidateThread = () =>
    void queryClient.invalidateQueries({ queryKey: ["thread", messageId] });

  // Re-converge the thread to server truth after a reconnect or tab-foreground (missed deltas).
  useRealtimeResync(invalidateThread);

  // The thread is SSR'd anonymously — on a hard refresh the loader runs server-side with no token, so
  // my_vote comes back 0 for everyone (score is caller-independent, so it still reads correctly). For a
  // signed-in reader, revalidate once on mount so their own vote colours light up; without this a
  // refresh drops the colour AND the vote control (seeded from my_vote=0) won't toggle the vote off on
  // the next click. Anonymous readers have nothing to resolve, so skip the extra fetch.
  useEffect(() => {
    if (userId) invalidateThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, messageId]);

  const root = thread?.root ?? null;
  const roomLookup = useMemo(() => new Map(rooms.map((r) => [r.id, r.slug])), [rooms]);
  // The room slug comes from the PERSISTED rooms cache (empty server-side / while restoring), but the
  // thread root is now SSR'd via the loader — so resolve the slug only after restore, falling back to
  // the default until then, to keep the back-link identical across SSR and the first client render.
  const isRestoring = useIsRestoring();
  const slug = root && !isRestoring ? (roomLookup.get(root.room_id) ?? "sheshi") : "sheshi";
  const replyTotal = useMemo(() => (thread ? countNodes(thread.replies) : 0), [thread]);
  // Realtime is scoped to the ROOM, not a per-thread group: vote/create/delete all broadcast to the
  // room channel, and this view filters them to messages it actually shows. Per-thread groups were
  // keyed by the permalink message id on the client but by the true thread-root id on the server
  // broadcast, so a reply permalink (a subcomment's own page) never received its echoes.
  const roomId = root?.room_id ?? null;

  // One composer for the whole thread, docked at the bottom. Clicking "Reply" on a comment
  // just points that one box at the comment (shown as a "replying to @user" chip) — no inline
  // boxes, which read poorly on mobile. Clicking the same reply again clears the target.
  const handleReply = (m: MessageRow) => {
    setReplyTarget((current) =>
      current?.messageId === m.id
        ? null
        : {
            messageId: m.id,
            label: m.author?.username ? `@${m.author.username}` : "@anonim",
            excerpt: m.deleted_at ? sq.chat.deleted : m.body.slice(0, 120),
          },
    );
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  // Reset per-thread scroll tracking when navigating to a different thread (same component instance).
  useEffect(() => {
    hadDataRef.current = false;
    lastReplyIdRef.current = null;
  }, [messageId]);

  // Apply scroll intents after the cached tree changes: land at the bottom on first load, and follow
  // new replies to the bottom when the reader is already near it (intent set by the realtime handler).
  useLayoutEffect(() => {
    if (!thread) return;
    const el = scrollRef.current;
    if (!el) return;
    const firstLoad = !hadDataRef.current;
    if (firstLoad) {
      hadDataRef.current = true;
      scrollToBottomRef.current = true;
    }
    if (scrollToBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: firstLoad ? "auto" : "smooth" });
      scrollToBottomRef.current = false;
    }
    lastReplyIdRef.current = findLastReplyId(thread.replies);
  }, [thread]);

  useEffect(() => {
    if (!root || typeof window === "undefined") return;
    const intent = window.sessionStorage.getItem("sheshi:reply-intent");
    if (intent !== root.id) return;
    window.sessionStorage.removeItem("sheshi:reply-intent");
    handleReply(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root?.id]);

  useEffect(() => {
    let disposed = false;
    const key = ["thread", messageId] as const;
    const read = () => queryClient.getQueryData<ThreadData | null>(key) ?? null;
    const write = (next: ThreadData) => queryClient.setQueryData<ThreadData | null>(key, next);

    // Super-realtime: patch the cached thread tree in place from typed events — no full refetch.
    const blank = (m: MessageRow): MessageRow => ({
      ...m,
      deleted_at: new Date().toISOString(),
      body: "",
      image_url: null,
      video_url: null,
    });
    const onCreated = (p: { message: MessageRow; root_id: string | null }) => {
      const msg = p.message;
      if (!msg || msg.parent_id == null) return; // only replies belong in a thread
      const prev = read();
      if (!prev) return;
      if (msg.id === prev.root.id || hasNode(prev.replies, msg.id)) return; // already have it
      // Room-scoped events include replies from other threads — only act when the parent is one of the
      // messages THIS view is showing (root or a loaded node); otherwise ignore it (no refetch storm).
      const parentInView = msg.parent_id === prev.root.id || hasNode(prev.replies, msg.parent_id);
      if (!parentInView) return;
      const el = scrollRef.current;
      const wasAtBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 120 : true;
      if (msg.parent_id === prev.root.id) {
        write({ ...prev, replies: [...prev.replies, { message: msg, replies: [], depth: 1 }] });
      } else {
        write({ ...prev, replies: insertUnderParent(prev.replies, msg.parent_id, msg).nodes });
      }
      if (wasAtBottom) scrollToBottomRef.current = true;
    };
    const onVote = (p: { message_id: string; score: number }) => {
      const prev = read();
      if (!prev) return;
      write(
        prev.root.id === p.message_id
          ? { ...prev, root: { ...prev.root, score: p.score } }
          : {
              ...prev,
              replies: updateNode(prev.replies, p.message_id, (m) => ({ ...m, score: p.score })),
            },
      );
    };
    const onDeleted = (p: { id: string }) => {
      const prev = read();
      if (!prev) return;
      write(
        prev.root.id === p.id
          ? { ...prev, root: blank(prev.root) }
          : { ...prev, replies: updateNode(prev.replies, p.id, blank) },
      );
    };
    // The caller's OWN vote, pushed only to their connections — syncs the vote colour (my_vote) across
    // this user's other devices/tabs (the public vote_changed echo only moves the score).
    const onMyVote = (p: { message_id: string; value: number }) => {
      const prev = read();
      if (!prev) return;
      write(
        prev.root.id === p.message_id
          ? { ...prev, root: { ...prev.root, my_vote: p.value } }
          : {
              ...prev,
              replies: updateNode(prev.replies, p.message_id, (m) => ({ ...m, my_vote: p.value })),
            },
      );
    };

    const connectionPromise = ensureRealtimeStarted();
    connectionPromise
      .then((connection) => {
        if (disposed) return;
        connection.on("message_created", onCreated);
        connection.on("vote_changed", onVote);
        connection.on("my_vote_changed", onMyVote);
        connection.on("message_deleted", onDeleted);
        if (roomId) void invokeRealtime("JoinRoom", roomId);
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
          if (roomId) void invokeRealtime("LeaveRoom", roomId);
        })
        .catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, messageId, userId]);

  const toggleCollapse = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <AppShell right={<HighlightsPanel currentUserId={userId} roomSlugLookup={roomLookup} />}>
      <div className="flex h-full flex-col">
        <div className="h-12 border-b border-border px-6 flex items-center gap-3 shrink-0">
          <Link
            to="/dhoma/$slug"
            params={{ slug }}
            className="inline-flex h-8 items-center gap-1 rounded-sm text-xs font-bold uppercase tracking-widest text-foreground/50 hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> #{slug}
          </Link>
          <span className="text-foreground/20" aria-hidden>
            /
          </span>
          <h2 className="font-display text-sm font-bold uppercase tracking-tight">
            {sq.chat.thread}
          </h2>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar">
          {loading ? (
            <ThreadSkeleton />
          ) : !root ? (
            <div className="p-10 text-center">
              <div className="text-xs uppercase tracking-widest font-bold text-foreground/40 mb-2">
                Tema nuk u gjet
              </div>
              <Link
                to="/"
                className="text-sm font-bold uppercase tracking-widest text-primary hover:text-primary/80"
              >
                Kthehu te dhomat
              </Link>
            </div>
          ) : (
            <>
              {/* This page renders ANY message as a thread root; when that message is itself a
                  reply, surface a way up to the post it answers. */}
              {root.parent_id ? (
                <Link
                  to="/tema/$messageId"
                  params={{ messageId: root.parent_id }}
                  className="flex items-center gap-2 border-b border-border bg-card/40 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-foreground/55 transition-colors hover:bg-card hover:text-primary sm:px-6"
                >
                  <ChevronUp className="h-4 w-4" aria-hidden />
                  {sq.chat.viewParent}
                </Link>
              ) : null}

              <MessageCard
                message={root}
                roomSlug={slug}
                currentUserId={userId}
                asThreadLink={false}
                onChanged={invalidateThread}
                onReply={handleReply}
              />

              <div className="border-y border-border bg-card/40 px-6 py-2 text-[10px] uppercase tracking-widest font-bold text-foreground/40">
                {sq.chat.replies(replyTotal)}
              </div>

              <div className="py-2">
                {(thread?.replies ?? []).map((node) => (
                  <ReplyBranch
                    key={node.message.id}
                    node={node}
                    slug={slug}
                    currentUserId={userId}
                    collapsed={collapsed}
                    onToggleCollapse={toggleCollapse}
                    onChanged={invalidateThread}
                    onReply={handleReply}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* One docked composer for the whole thread. When a comment is targeted it posts a
            reply to that comment (chip shows who); otherwise it replies to the thread root. */}
        {root && (
          <Composer
            key={root.id}
            ref={composerRef}
            roomId={root.room_id}
            parentId={replyTarget?.messageId ?? root.id}
            currentUserId={userId}
            onPosted={() => {
              setReplyTarget(null);
              scrollToBottomRef.current = true;
              invalidateThread();
            }}
            placeholder={
              replyTarget ? `${sq.chat.reply} ${replyTarget.label}…` : sq.chat.placeholder
            }
            replyContext={replyTarget}
            onClearReplyContext={replyTarget ? () => setReplyTarget(null) : undefined}
          />
        )}
      </div>
    </AppShell>
  );
}

// Thread connector geometry (px). The spine runs down the left gutter of a comment's children; each
// child turns off it with a rounded elbow that points at the child's avatar. Capped so deep threads
// don't crush the column on mobile — beyond CONTINUE_DEPTH we link out to the comment's own page.
const THREAD_INDENT = 22; // each nesting level indents its children this much
const SPINE_X = 10; // x of the vertical spine within a child's gutter
const ELBOW_Y = 21; // y where the elbow meets the child (≈ the avatar's centre)
const ELBOW_H = 10; // curve radius / height
const ELBOW_W = 12; // horizontal reach from the spine to the comment block
const MAX_INDENT_DEPTH = 7;
const CONTINUE_DEPTH = 8;

type BranchProps = {
  node: ReplyNode;
  slug: string;
  currentUserId: string | null;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onChanged: () => void;
  onReply: (message: MessageRow) => void;
};

// Renders a comment's children indented under a single vertical spine, each connected by a curved
// elbow. Stops indenting past MAX_INDENT_DEPTH so the column survives on mobile.
function ThreadChildren({
  replies,
  depth,
  ...rest
}: Omit<BranchProps, "node"> & { replies: ReplyNode[]; depth: number }) {
  const indent = depth <= MAX_INDENT_DEPTH ? THREAD_INDENT : 0;
  return (
    <div className="relative" style={{ paddingLeft: indent }}>
      {replies.map((child, i) => {
        const isLast = i === replies.length - 1;
        return (
          <div className="relative" key={child.message.id}>
            {indent > 0 && (
              <>
                {/* Vertical spine: full height for a middle child (joins the next sibling); for the
                    last child it stops at the elbow so the line ends cleanly at the final reply. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute w-px bg-thread-line"
                  style={{ left: SPINE_X, top: 0, height: isLast ? ELBOW_Y : "100%" }}
                />
                {/* Curved elbow turning off the spine toward this child's avatar. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute border-b border-l border-thread-line"
                  style={{
                    left: SPINE_X,
                    top: ELBOW_Y - ELBOW_H,
                    width: ELBOW_W,
                    height: ELBOW_H,
                    borderBottomLeftRadius: ELBOW_H,
                  }}
                />
              </>
            )}
            <ReplyBranch node={child} {...rest} />
          </div>
        );
      })}
    </div>
  );
}

function ReplyBranch({
  node,
  slug,
  currentUserId,
  collapsed,
  onToggleCollapse,
  onChanged,
  onReply,
}: BranchProps) {
  const isCollapsed = collapsed.has(node.message.id);
  const hiddenCount = countNodes(node.replies);
  const hasChildren = hiddenCount > 0;
  const continueHere = hasChildren && node.depth >= CONTINUE_DEPTH;
  const showChildren = !isCollapsed && hasChildren && !continueHere;

  return (
    <div className="relative">
      <MessageCard
        message={node.message}
        roomSlug={slug}
        currentUserId={currentUserId}
        asThreadLink={false}
        onChanged={onChanged}
        onReply={onReply}
        compact
        collapsible={hasChildren}
        collapsed={isCollapsed}
        onToggleCollapse={() => onToggleCollapse(node.message.id)}
      />

      {hasChildren && isCollapsed ? (
        <button
          type="button"
          onClick={() => onToggleCollapse(node.message.id)}
          className="mb-2 ml-3 inline-flex min-h-7 items-center gap-1.5 rounded-full border border-thread-line px-2.5 py-1 text-[11px] font-bold text-foreground/60 transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          {sq.chat.replies(hiddenCount)}
        </button>
      ) : null}

      {showChildren ? (
        <ThreadChildren
          replies={node.replies}
          depth={node.depth + 1}
          slug={slug}
          currentUserId={currentUserId}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          onChanged={onChanged}
          onReply={onReply}
        />
      ) : null}

      {continueHere && !isCollapsed ? (
        <Link
          to="/tema/$messageId"
          params={{ messageId: node.message.id }}
          className="mb-2 ml-3 inline-flex items-center gap-1 text-xs font-bold text-primary transition-colors hover:text-primary/80"
        >
          {sq.chat.continueThread} ({sq.chat.replies(hiddenCount)}) →
        </Link>
      ) : null}
    </div>
  );
}

function countNodes(nodes: ReplyNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.replies), 0);
}

function findLastReplyId(nodes: ReplyNode[]): string | null {
  let last: string | null = null;
  for (const node of nodes) {
    last = findLastReplyId(node.replies) ?? node.message.id;
  }
  return last;
}
