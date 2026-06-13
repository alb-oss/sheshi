import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Composer, type ComposerHandle } from "@/components/Composer";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { MessageCard } from "@/components/MessageCard";
import { sq } from "@/i18n/sq";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
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
  const composerWrapRef = useRef<HTMLDivElement | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  activeMessageIdRef.current = messageId;

  const root = thread?.root ?? null;
  const roomLookup = useMemo(() => new Map(rooms.map((r) => [r.id, r.slug])), [rooms]);
  const slug = root ? (roomLookup.get(root.room_id) ?? "sheshi") : "sheshi";
  const replyTotal = useMemo(() => (thread ? countNodes(thread.replies) : 0), [thread]);
  const joinedThreadId = root?.id ?? messageId;
  const rootReplyContext = root
    ? {
        label: root.author?.username ? `@${root.author.username}` : "@anonim",
        excerpt: root.deleted_at ? sq.chat.deleted : root.body.slice(0, 120),
      }
    : null;

  const handleReply = (m: MessageRow) => {
    const username = m.author?.username;
    const label = username ? `@${username}` : "@anonim";
    const excerpt = m.deleted_at ? sq.chat.deleted : m.body.slice(0, 120);
    setReplyTarget({ messageId: m.id, label, excerpt });
    requestAnimationFrame(() => {
      composerWrapRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      composerRef.current?.focus();
    });
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
    let handler: (() => void) | null = null;
    reload();
    const connectionPromise = ensureRealtimeStarted();
    connectionPromise
      .then((connection) => {
        if (disposed) return;
        handler = reload;
        connection.on("changed", handler);
        void invokeRealtime("JoinThread", joinedThreadId);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      connectionPromise
        .then((connection) => {
          if (handler) connection.off("changed", handler);
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
                {thread.replies.map((node) => (
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

        {root && (
          <div ref={composerWrapRef}>
            <Composer
              key={replyTarget?.messageId ?? root.id}
              ref={composerRef}
              roomId={root.room_id}
              parentId={replyTarget?.messageId ?? root.id}
              currentUserId={userId}
              onPosted={reload}
              placeholder={sq.chat.reply + "…"}
              replyContext={replyTarget ?? rootReplyContext}
              onClearReplyContext={replyTarget ? () => setReplyTarget(null) : undefined}
            />
          </div>
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
  const levelIndent = node.depth > 1 && node.depth <= 6 ? 12 : 0;
  const contentIndentClass = node.depth <= 6 ? "pl-3 sm:pl-4" : "pl-0";

  return (
    <div className="relative" style={{ marginLeft: levelIndent }}>
      <div
        className={cn(
          "absolute left-2 top-0 bottom-0 w-px bg-border/70",
          node.depth > 6 && "bg-primary/30",
        )}
        aria-hidden
      />
      <div className={contentIndentClass}>
        <MessageCard
          message={node.message}
          roomSlug={slug}
          currentUserId={currentUserId}
          asThreadLink={false}
          onChanged={onChanged}
          onReply={onReply}
          compact
        />

        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => onToggleCollapse(node.message.id)}
            className="ml-6 mb-2 inline-flex min-h-8 items-center gap-1.5 rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-foreground/45 hover:bg-card hover:text-primary"
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
            {isCollapsed ? `Shfaq ${sq.chat.replies(hiddenCount)}` : "Mbyll përgjigjet"}
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
