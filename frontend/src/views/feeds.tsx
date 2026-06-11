import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { roomPath, threadPath } from "../api";
import { displayName, findReplyNode, navigate, sortHomeThreads } from "../appSupport";
import type { HomeSort } from "../appSupport";
import type { Message, Room, Thread } from "../types";
import { Composer, ReplyComposer, ReplyTree, ThreadCard } from "../components/messages";
import { EmptyState, LoadingRows } from "../components/overlays";

export function Home(props: {
  rooms: Room[];
  highlights: Message[];
  searchQuery: string;
  loadStatus: "idle" | "loading" | "ready" | "error";
  loadError?: string;
  onRetry: () => void;
  canCreateRooms: boolean;
  onCreate: () => void;
  onVote: (message: Message) => void;
  onSave: (message: Message) => void;
  onShare: (message: Message) => void;
  savedIds: Set<string>;
  requireAuth: () => boolean;
}) {
  const [sort, setSort] = useState<HomeSort>("hot");
  const roomById = useMemo(() => new Map(props.rooms.map((room) => [room.id, room])), [props.rooms]);
  const search = props.searchQuery.trim().toLowerCase();
  const sortedMessages = useMemo(() => {
    const messages = sortHomeThreads(props.highlights, sort);
    if (!search) return messages;
    return messages.filter((message) => {
      const room = roomById.get(message.room_id);
      return [
        message.body,
        displayName(message.author),
        room?.name || "",
        room?.slug || "",
        room?.description || ""
      ].some((value) => value.toLowerCase().includes(search));
    });
  }, [props.highlights, roomById, search, sort]);

  return (
    <section className="home">
      <div className="view-head">
        <div>
          <p className="crumb">FRONTPAGE</p>
          <h1>Postimet kryesore</h1>
        </div>
        <span className="live-pill">{sortedMessages.length} tema</span>
      </div>
      <div className="home-tabs" role="tablist" aria-label="Rendit postimet">
        <button className={sort === "hot" ? "active" : ""} onClick={() => setSort("hot")}>Hot</button>
        <button className={sort === "new" ? "active" : ""} onClick={() => setSort("new")}>Te reja</button>
        <button className={sort === "top" ? "active" : ""} onClick={() => setSort("top")}>Top</button>
        <button className={sort === "replied" ? "active" : ""} onClick={() => setSort("replied")}>Pergjigje</button>
      </div>
      <div className="feed-list front-feed">
        {props.loadStatus === "loading" && sortedMessages.length === 0 && <LoadingRows />}
        {props.loadStatus === "error" && sortedMessages.length === 0 && (
          <EmptyState
            title={props.loadError || "Postimet nuk u ngarkuan"}
            action="Provo perseri"
            onAction={props.onRetry}
          />
        )}
        {props.loadStatus === "error" && sortedMessages.length > 0 && (
          <LoadNotice message={props.loadError || "Postimet nuk u rifreskuan."} onRetry={props.onRetry} />
        )}
        {props.loadStatus !== "loading" && props.loadStatus !== "error" && sortedMessages.length === 0 && (
          <EmptyState
            title={search ? "Asgje nuk u gjet" : "Ende nuk ka tema"}
            action={props.canCreateRooms ? "Krijo dhome" : "Shiko dhomat"}
            onAction={props.canCreateRooms ? props.onCreate : () => undefined}
          />
        )}
        {sortedMessages.map((message) => (
          <ThreadCard
            key={message.id}
            message={message}
            room={roomById.get(message.room_id) || null}
            onVote={props.onVote}
            onSave={props.onSave}
            onShare={props.onShare}
            isSaved={props.savedIds.has(message.id)}
            onReply={(target) => {
              if (props.requireAuth()) navigate(threadPath(target.id));
            }}
          />
        ))}
      </div>
    </section>
  );
}

export function RoomView(props: {
  room: Room;
  messages: Message[];
  loadStatus: "idle" | "loading" | "ready" | "error";
  loadError?: string;
  cursor: string | null;
  onRetry: () => void;
  onMore: () => void;
  onSubmit: (body: string) => Promise<boolean>;
  onVote: (message: Message) => void;
  onSave: (message: Message) => void;
  onShare: (message: Message) => void;
  savedIds: Set<string>;
  requireAuth: () => boolean;
  canCreateThreads: boolean;
}) {
  return (
    <section className="room-view">
      <div className="view-head">
        <div>
          <p className="crumb">DHOMA / {props.room.name}</p>
          <h1>Tema</h1>
        </div>
        <span className="live-pill">{props.room.thread_count} tema</span>
      </div>
      {props.canCreateThreads && (
        <Composer placeholder="Hap nje teme te re" onSubmit={props.onSubmit} requireAuth={props.requireAuth} />
      )}
      <div className="feed-list">
        {props.loadStatus === "loading" && props.messages.length === 0 && <LoadingRows />}
        {props.loadStatus === "error" && props.messages.length === 0 && (
          <EmptyState
            title={props.loadError || "Temat nuk u ngarkuan"}
            action="Provo perseri"
            onAction={props.onRetry}
          />
        )}
        {props.loadStatus === "error" && props.messages.length > 0 && (
          <LoadNotice message={props.loadError || "Temat nuk u rifreskuan."} onRetry={props.onRetry} />
        )}
        {props.loadStatus !== "loading" && props.loadStatus !== "error" && props.messages.length === 0 && (
          props.canCreateThreads
            ? <EmptyState title="Ende nuk ka tema" action="Shkruaj temen e pare" onAction={props.requireAuth} />
            : <EmptyState title="Ende nuk ka tema" />
        )}
        {props.messages.map((message) => (
          <ThreadCard
            key={message.id}
            message={message}
            onVote={props.onVote}
            onSave={props.onSave}
            onShare={props.onShare}
            isSaved={props.savedIds.has(message.id)}
            onReply={(target) => {
              if (props.requireAuth()) navigate(threadPath(target.id));
            }}
          />
        ))}
      </div>
      {props.cursor && <button className="load-more" onClick={props.onMore}>ME SHUME</button>}
    </section>
  );
}

export function ThreadView(props: {
  thread: Thread | null;
  selectedId: string;
  loadStatus: "idle" | "loading" | "ready" | "error";
  loadError?: string;
  notFound?: boolean;
  rooms: Room[];
  onRetry: () => void;
  onSubmit: (roomId: string, body: string, parentId?: string | null) => Promise<boolean>;
  onVote: (message: Message) => void;
  onSave: (message: Message) => void;
  onShare: (message: Message) => void;
  savedIds: Set<string>;
  requireAuth: () => boolean;
}) {
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);

  useEffect(() => {
    setReplyTarget(null);
  }, [props.thread?.root.id]);

  if (props.loadStatus === "loading") return <LoadingRows />;
  if (!props.thread) {
    return (
      <EmptyState
        title={props.loadError || "Tema nuk u ngarkua"}
        action={props.notFound ? "Kthehu te dhomat" : "Provo perseri"}
        onAction={props.notFound ? () => navigate("/") : props.onRetry}
      />
    );
  }

  const room = props.rooms.find((item) => item.id === props.thread!.root.room_id);
  const focusedNode = props.selectedId === props.thread.root.id ? null : findReplyNode(props.thread.replies, props.selectedId);
  const focusedMessage = focusedNode?.message ?? props.thread.root;
  const visibleReplies = focusedNode?.replies ?? props.thread.replies;
  const depthOffset = focusedNode?.depth ?? 0;
  const isReplyDetail = Boolean(focusedNode);

  return (
    <section className="thread-view">
      <div className="view-head">
        <button className="back-button" onClick={() => navigate(room ? roomPath(room.slug) : "/")}>
          <ArrowLeft size={17} /> {room?.name || "Dhomat"}
        </button>
        <p className="crumb">{isReplyDetail ? "PERGJIGJE" : "TEMA"}</p>
      </div>

      {isReplyDetail && (
        <button className="thread-context" onClick={() => navigate(threadPath(props.thread!.root.id))}>
          <span>Tema kryesore</span>
          <strong>{props.thread.root.body}</strong>
        </button>
      )}

      <ThreadCard
        message={focusedMessage}
        root
        onVote={props.onVote}
        onSave={props.onSave}
        onShare={props.onShare}
        isSaved={props.savedIds.has(focusedMessage.id)}
        onReply={() => props.requireAuth() && setReplyTarget(focusedMessage)}
      />

      {replyTarget?.id === focusedMessage.id && (
        <ReplyComposer
          target={replyTarget}
          onSubmit={(body) => props.onSubmit(replyTarget.room_id, body, replyTarget.id).then((ok) => {
            if (ok) setReplyTarget(null);
            return ok;
          })}
          onCancel={() => setReplyTarget(null)}
        />
      )}

      <div className="reply-stack">
        {visibleReplies.map((node) => (
          <ReplyTree
            key={node.message.id}
            node={node}
            depthOffset={depthOffset}
            replyTarget={replyTarget}
            setReplyTarget={(message) => props.requireAuth() && setReplyTarget(message)}
            onVote={props.onVote}
            onSave={props.onSave}
            onShare={props.onShare}
            savedIds={props.savedIds}
            onSubmit={props.onSubmit}
            onCancel={() => setReplyTarget(null)}
          />
        ))}
      </div>
    </section>
  );
}

function LoadNotice(props: { message: string; onRetry: () => void }) {
  return (
    <div className="load-notice">
      <span>{props.message}</span>
      <button type="button" onClick={props.onRetry}>Provo perseri</button>
    </div>
  );
}
