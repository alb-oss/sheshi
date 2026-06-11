import { useState } from "react";
import type { CSSProperties } from "react";
import { ArrowBigUp, Bookmark, ChevronRight, MessageSquare, Plus, Send, Share2 } from "lucide-react";
import { roomPath, threadPath } from "../api";
import { authorAccent, authorInitial, displayName, navigate, timeAgo } from "../appSupport";
import type { Message, ReplyNode, Room } from "../types";

export function ThreadCard(props: {
  message: Message;
  room?: Room | null;
  root?: boolean;
  isSaved: boolean;
  onVote: (message: Message) => void;
  onSave: (message: Message) => void;
  onShare: (message: Message) => void;
  onReply: (message: Message) => void | boolean;
}) {
  return (
    <article className={`thread-card ${props.root ? "root" : ""}`} onClick={() => !props.root && navigate(threadPath(props.message.id))}>
      <AuthorAvatar author={props.message.author} />
      <div className="thread-main">
        <div className="meta-line">
          {props.room && (
            <button
              className="room-badge"
              onClick={(event) => {
                event.stopPropagation();
                navigate(roomPath(props.room!.slug));
              }}
            >
              {props.room.name}
            </button>
          )}
          <span className="author">{displayName(props.message.author)}</span>
          <span>{timeAgo(props.message.created_at)}</span>
          {props.message.deleted_at && <span>fshire</span>}
        </div>
        <p className="message-body">{props.message.deleted_at ? "Ky mesazh eshte fshire." : props.message.body}</p>
        <ActionRow message={props.message} isSaved={props.isSaved} onVote={props.onVote} onSave={props.onSave} onShare={props.onShare} onReply={props.onReply} />
      </div>
      {!props.root && <ChevronRight className="open-indicator" size={18} />}
    </article>
  );
}

function AuthorAvatar(props: { author?: Message["author"] | null; compact?: boolean }) {
  const style = { "--avatar-hue": authorAccent(props.author) } as CSSProperties;
  return (
    <span className={`author-avatar ${props.compact ? "compact" : ""}`} style={style}>
      {props.author?.avatar_url ? <img src={props.author.avatar_url} alt="" /> : authorInitial(props.author)}
    </span>
  );
}

function ActionRow(props: {
  message: Message;
  isSaved: boolean;
  onVote: (message: Message) => void;
  onSave: (message: Message) => void;
  onShare: (message: Message) => void;
  onReply: (message: Message) => void | boolean;
}) {
  return (
    <div className="action-row" onClick={(event) => event.stopPropagation()}>
      <button className={`inline-vote ${props.message.voted ? "voted" : ""}`} onClick={() => props.onVote(props.message)} aria-label="Voto" aria-pressed={props.message.voted}>
        <ArrowBigUp size={17} fill={props.message.voted ? "currentColor" : "none"} /> {props.message.upvotes}
      </button>
      <button className="text-action" onClick={() => props.onReply(props.message)}>
        <MessageSquare size={15} /> PERGJIGJU {props.message.reply_count > 0 ? `(${props.message.reply_count})` : ""}
      </button>
      <button
        className="icon-share"
        aria-label="Shperndaj"
        title="Shperndaj"
        onClick={() => props.onShare(props.message)}
      >
        <Share2 size={16} />
      </button>
      <button
        className={`icon-save ${props.isSaved ? "saved" : ""}`}
        aria-label={props.isSaved ? "Hiq nga ruajtjet" : "Ruaj"}
        aria-pressed={props.isSaved}
        title={props.isSaved ? "Hiq nga ruajtjet" : "Ruaj"}
        onClick={() => props.onSave(props.message)}
      >
        <Bookmark size={16} fill={props.isSaved ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

export function ReplyTree(props: {
  node: ReplyNode;
  depthOffset?: number;
  replyTarget: Message | null;
  setReplyTarget: (message: Message) => void | boolean;
  onVote: (message: Message) => void;
  onSave: (message: Message) => void;
  onShare: (message: Message) => void;
  savedIds: Set<string>;
  onSubmit: (roomId: string, body: string, parentId?: string | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const depth = Math.min(Math.max(props.node.depth - (props.depthOffset ?? 0), 1), 6);

  return (
    <div className="reply-node" style={{ "--depth": depth } as CSSProperties}>
      <div className="reply-line" />
      <div className="reply-content openable" onClick={() => navigate(threadPath(props.node.message.id))}>
        <div className="reply-head">
          <AuthorAvatar author={props.node.message.author} compact />
          <div className="meta-line">
            <span className="author">{displayName(props.node.message.author)}</span>
            <span>{timeAgo(props.node.message.created_at)}</span>
          </div>
        </div>
        <p className="message-body small">{props.node.message.deleted_at ? "Ky mesazh eshte fshire." : props.node.message.body}</p>
        <div className="action-row compact" onClick={(event) => event.stopPropagation()}>
          <button className={`inline-vote ${props.node.message.voted ? "voted" : ""}`} onClick={() => props.onVote(props.node.message)} aria-label="Voto" aria-pressed={props.node.message.voted}>
            <ArrowBigUp size={16} fill={props.node.message.voted ? "currentColor" : "none"} /> {props.node.message.upvotes}
          </button>
          <button className="text-action" onClick={() => props.setReplyTarget(props.node.message)}><MessageSquare size={14} /> PERGJIGJU</button>
          {props.node.replies.length > 0 && (
            <button className="text-action" onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? "HAP" : "MBYLL"} ({props.node.replies.length})
            </button>
          )}
          <button
            className="icon-share"
            aria-label="Shperndaj"
            title="Shperndaj"
            onClick={() => props.onShare(props.node.message)}
          >
            <Share2 size={15} />
          </button>
          <button
            className={`icon-save ${props.savedIds.has(props.node.message.id) ? "saved" : ""}`}
            aria-label={props.savedIds.has(props.node.message.id) ? "Hiq nga ruajtjet" : "Ruaj"}
            aria-pressed={props.savedIds.has(props.node.message.id)}
            title={props.savedIds.has(props.node.message.id) ? "Hiq nga ruajtjet" : "Ruaj"}
            onClick={() => props.onSave(props.node.message)}
          >
            <Bookmark size={15} fill={props.savedIds.has(props.node.message.id) ? "currentColor" : "none"} />
          </button>
        </div>
        {props.replyTarget?.id === props.node.message.id && (
          <ReplyComposer
            target={props.replyTarget}
            onSubmit={(body) => props.onSubmit(props.replyTarget!.room_id, body, props.replyTarget!.id).then((ok) => {
              if (ok) props.onCancel();
              return ok;
            })}
            onCancel={props.onCancel}
          />
        )}
      </div>
      {!collapsed && props.node.replies.map((child) => (
        <ReplyTree key={child.message.id} {...props} node={child} />
      ))}
    </div>
  );
}

export function Composer(props: { placeholder: string; onSubmit: (body: string) => Promise<boolean>; requireAuth: () => boolean }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  function openComposer() {
    if (!props.requireAuth()) return;
    setExpanded(true);
  }

  async function submitComposerMessage() {
    if (!props.requireAuth() || body.trim().length === 0) return;
    setBusy(true);
    const ok = await props.onSubmit(body.trim());
    setBusy(false);
    if (ok) {
      setBody("");
      setExpanded(false);
    }
  }

  if (!expanded) {
    return (
      <div className="composer composer-compact">
        <button className="composer-entry" onClick={openComposer}>
          <span className="composer-entry-icon"><Plus size={17} /></span>
          <span>
            <strong>Krijo teme</strong>
            <small>{props.placeholder}</small>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="composer composer-expanded">
      <textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} placeholder={props.placeholder} />
      <div className="composer-actions">
        <span>{body.length}/2000</span>
        <div className="composer-action-buttons">
          <button className="ghost-button" onClick={() => {
            setBody("");
            setExpanded(false);
          }}>ANULO</button>
          <button className="primary-button" disabled={busy || body.trim().length === 0} onClick={submitComposerMessage}><Send size={16} /> DERGO</button>
        </div>
      </div>
    </div>
  );
}

export function ReplyComposer(props: { target: Message; onSubmit: (body: string) => Promise<boolean>; onCancel: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitReplyMessage() {
    if (!body.trim()) return;
    setBusy(true);
    const ok = await props.onSubmit(body.trim());
    setBusy(false);
    if (ok) setBody("");
  }

  return (
    <div className="reply-composer" onClick={(event) => event.stopPropagation()}>
      <div className="reply-target">
        <span>Pergjigje</span>
        <em>{props.target.body.slice(0, 90)}</em>
      </div>
      <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Shkruaj pergjigjen" />
      <div className="composer-actions">
        <button className="ghost-button" onClick={props.onCancel}>ANULO</button>
        <button className="primary-button" disabled={busy || body.trim().length === 0} onClick={submitReplyMessage}><Send size={16} /> DERGO</button>
      </div>
    </div>
  );
}
