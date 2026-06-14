import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Composer, type ComposerHandle } from "@/components/Composer";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { MessageCard } from "@/components/MessageCard";
import { sq } from "@/i18n/sq";
import { useAuth } from "@/hooks/use-auth";
import {
  getThread,
  listRooms,
  type MessageRow,
  type ReplyNode,
  type Room,
  type ThreadData,
} from "@/lib/sheshi";
import { ensureRealtimeStarted, invokeRealtime } from "@/lib/realtime";

export const Route = createFileRoute("/tema/$messageId")({
  head: () => ({ meta: [{ title: "Tema — Sheshi" }] }),
  component: ThreadPage,
});

type ReplyTarget = {
  messageId: string;
  label: string;
  excerpt?: string;
};

// Pure, immutable tree updates for super-realtime delta-apply (Phase A).
function updateNode(nodes: ReplyNode[], id: string, fn: (m: MessageRow) => MessageRow): ReplyNode[] {
  return nodes.map((n) =>
    n.message.id === id
      ? { ...n, message: fn(n.message) }
      : { ...n, replies: updateNode(n.replies, id, fn) });
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
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastReplyIdRef = useRef<string | null>(null);
  const activeMessageIdRef = useRef(messageId);
  const reloadRequestIdRef = useRef(0);
  const composerRef = useRef<ComposerHandle | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  activeMessageIdRef.current = messageId;

  const root = thread?.root ?? null;
  const roomLookup = useMemo(() => new Map(rooms.map((r) => [r.id, r.slug])), [rooms]);
  const slug = root ? (roomLookup.get(root.room_id) ?? "sheshi") : "sheshi";
  const replyTotal = useMemo(() => (thread ? countNodes(thread.replies) : 0), [thread]);
  const joinedThreadId = root?.id ?? messageId;

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
          });
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const reload = () => {
    const requestedMessageId = messageId;
    const requestId = reloadRequestIdRef.current + 1;
    reloadRequestIdRef.current = requestId;
    const isCurrentRequest = () =>
      reloadRequestIdRef.current === requestId && activeMessageIdRef.current === requestedMessageId;

    setLoading((current) => current && !thread);
    getThread(requestedMessageId)
      .then((data) => {
        if (!isCurrentRequest()) return;
        const lastReplyId = data ? findLastReplyId(data.replies) : null;
        const el = scrollRef.current;
        const wasAtBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 120 : true;
        const isNew = lastReplyId && lastReplyId !== lastReplyIdRef.current;

        setThread(data);
        lastReplyIdRef.current = lastReplyId;

        requestAnimationFrame(() => {
          if (!isCurrentRequest()) return;
          if (el && (wasAtBottom || isNew))
            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        });
      })
      .catch(() => {
        if (!isCurrentRequest()) return;
        setThread(null);
      })
      .finally(() => {
        if (isCurrentRequest()) setLoading(false);
      });
  };

  useEffect(() => {
    listRooms().then(setRooms).catch(() => {});
  }, []);

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
    reload();

    // Super-realtime: mutate the thread tree in place from typed events — no full reload.
    const blank = (m: MessageRow): MessageRow => ({
      ...m, deleted_at: new Date().toISOString(), body: "", image_url: null,
    });
    const onCreated = (p: { message: MessageRow; root_id: string | null }) => {
      const msg = p.message;
      if (!msg || msg.parent_id == null) return;
      if (p.root_id && p.root_id !== joinedThreadId) return; // a reply in another thread
      setThread((prev) => {
        if (!prev) return prev;
        if (msg.id === prev.root.id || hasNode(prev.replies, msg.id)) return prev; // dedupe
        if (msg.parent_id === prev.root.id)
          return { ...prev, replies: [...prev.replies, { message: msg, replies: [], depth: 1 }] };
        const r = insertUnderParent(prev.replies, msg.parent_id!, msg);
        if (!r.inserted) { reload(); return prev; } // parent not loaded → fall back to a refetch
        return { ...prev, replies: r.nodes };
      });
    };
    const onVote = (p: { message_id: string; score: number }) =>
      setThread((prev) =>
        !prev ? prev
          : prev.root.id === p.message_id
            ? { ...prev, root: { ...prev.root, score: p.score } }
            : { ...prev, replies: updateNode(prev.replies, p.message_id, (m) => ({ ...m, score: p.score })) });
    const onDeleted = (p: { id: string }) =>
      setThread((prev) =>
        !prev ? prev
          : prev.root.id === p.id
            ? { ...prev, root: blank(prev.root) }
            : { ...prev, replies: updateNode(prev.replies, p.id, blank) });

    const connectionPromise = ensureRealtimeStarted();
    connectionPromise
      .then((connection) => {
        if (disposed) return;
        connection.on("message_created", onCreated);
        connection.on("vote_changed", onVote);
        connection.on("message_deleted", onDeleted);
        void invokeRealtime("JoinThread", joinedThreadId);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      connectionPromise
        .then((connection) => {
          connection.off("message_created", onCreated);
          connection.off("vote_changed", onVote);
          connection.off("message_deleted", onDeleted);
          void invokeRealtime("LeaveThread", joinedThreadId);
        })
        .catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinedThreadId, messageId, userId]);

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
            <div className="p-6 text-xs uppercase tracking-widest font-bold text-foreground/40">
              {sq.chat.loading}
            </div>
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
              <MessageCard
                message={root}
                roomSlug={slug}
                currentUserId={userId}
                asThreadLink={false}
                onChanged={reload}
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
                    onChanged={reload}
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
              reload();
            }}
            placeholder={replyTarget ? `${sq.chat.reply} ${replyTarget.label}…` : sq.chat.placeholder}
            replyContext={replyTarget}
            onClearReplyContext={replyTarget ? () => setReplyTarget(null) : undefined}
          />
        )}
      </div>
    </AppShell>
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
}: {
  node: ReplyNode;
  slug: string;
  currentUserId: string | null;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onChanged: () => void;
  onReply: (message: MessageRow) => void;
}) {
  const isCollapsed = collapsed.has(node.message.id);
  const hiddenCount = countNodes(node.replies);
  const hasChildren = hiddenCount > 0;
  // Consistent ~16px indent per nesting level (depth 1 = top-level reply, no indent), clamped.
  const levelIndent = node.depth > 1 ? Math.min(node.depth - 1, 8) * 16 : 0;

  return (
    <div className="relative" style={{ marginLeft: levelIndent }}>
      {/* Static thread guide line in the left gutter. Collapsing is driven by the comment's
          own [–]/[+] head toggle (and the [+] pill below) — never by clicking this line. */}
      <div className="absolute bottom-0 left-2 top-0 w-px bg-thread-line" aria-hidden />
      <div className="pl-4 sm:pl-5">
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
            className="mb-2 ml-1 inline-flex min-h-7 items-center gap-1.5 rounded-full border border-thread-line px-2.5 py-1 text-[11px] font-bold text-foreground/60 transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            {sq.chat.replies(hiddenCount)}
          </button>
        ) : null}

        {!isCollapsed &&
          node.replies.map((child) => (
            <ReplyBranch
              key={child.message.id}
              node={child}
              slug={slug}
              currentUserId={currentUserId}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onChanged={onChanged}
              onReply={onReply}
            />
          ))}
      </div>
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
