import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowBigUp,
  Bookmark,
  ChevronRight,
  Copy,
  Flame,
  Link2,
  LogOut,
  Mail,
  MessageSquare,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sun,
  UserRound
} from "lucide-react";
import { roomPath, threadPath } from "./api";
import {
  authorAccent,
  authorInitial,
  displayName,
  navigate,
  timeAgo
} from "./appSupport";
import type { AuthState, RoomRailMode, Theme } from "./appSupport";
import type { Message, ReplyNode, Room } from "./types";

export type ShareTarget = {
  title: string;
  text: string;
  url: string;
  roomName?: string | null;
};

export function TopBar(props: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  auth: AuthState;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  canCreateRooms: boolean;
  canModerate: boolean;
  onAuth: () => void;
  hideAuthAction?: boolean;
  onCreate: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => navigate("/")} aria-label="Sheshi">
        <img className="brand-mark" src="/sheshi-mark.svg" alt="" />
        <span>
          <strong>SHESHI</strong>
          <small>Zeri qytetar live</small>
        </span>
      </button>
      <label className="searchbox">
        <Search size={16} />
        <input
          value={props.searchQuery}
          onChange={(event) => props.setSearchQuery(event.target.value)}
          onFocus={() => navigate("/")}
          placeholder="Kerko dhoma, tema, fjale kyce"
        />
      </label>
      <div className="top-actions">
        <button className="icon-button" onClick={() => props.setTheme(props.theme === "dark" ? "light" : "dark")} aria-label="Ndrysho temen">
          {props.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {props.auth ? (
          <>
            {props.canModerate && <button className="primary-button admin-button" onClick={() => navigate("/moderim")}><ShieldCheck size={16} /> MODERIM</button>}
            <button className="ghost-button" onClick={() => navigate("/profili")}><UserRound size={16} /> PROFILI</button>
            <button className="primary-button" onClick={props.onLogout}><LogOut size={16} /> DIL</button>
          </>
        ) : !props.hideAuthAction ? (
          <button className="primary-button login" onClick={props.onAuth}><UserRound size={16} /> HYR</button>
        ) : null}
        {props.canCreateRooms && <button className="primary-button create" onClick={props.onCreate}><Plus size={16} /> KRIJO DHOME</button>}
      </div>
    </header>
  );
}

export function AdminModeBar(props: {
  label: string;
  roomsCount: number;
  onCreate: () => void;
}) {
  return (
    <section className="admin-mode-bar" aria-label="Admin mode">
      <div className="admin-mode-status">
        <ShieldCheck size={16} />
        <span>ADMIN MODE</span>
        <strong>{props.label}</strong>
      </div>
      <div className="admin-mode-meta">
        <span>{props.roomsCount} dhoma</span>
        <button type="button" onClick={() => navigate("/moderim")}>Moderim</button>
        <button type="button" onClick={props.onCreate}><Plus size={14} /> Dhome</button>
      </div>
    </section>
  );
}

export function RoomRail(props: { rooms: Room[]; activeRoom: Room | null; canCreateRooms: boolean; onCreate: () => void }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<RoomRailMode>("active");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRooms = useMemo(() => {
    return props.rooms
      .filter((room) => {
        if (mode === "active" && room.thread_count === 0 && props.activeRoom?.id !== room.id) return false;
        if (!normalizedQuery) return true;
        return [room.name, room.slug, room.description || ""].some((value) => value.toLowerCase().includes(normalizedQuery));
      });
  }, [props.rooms, props.activeRoom?.id, mode, normalizedQuery]);

  return (
    <aside className="room-rail">
      <div className="rail-head">
        <div className="section-label">DHOMA</div>
        {props.canCreateRooms && <button className="rail-create icon-only" onClick={props.onCreate} aria-label="Krijo dhome"><Plus size={15} /></button>}
      </div>
      <label className="rail-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kerko dhoma" />
      </label>
      <div className="rail-tabs" role="tablist" aria-label="Filtro dhomat">
        <button className={mode === "active" ? "active" : ""} onClick={() => setMode("active")}>Aktive</button>
        <button className={mode === "all" ? "active" : ""} onClick={() => setMode("all")}>Te gjitha</button>
      </div>
      <nav aria-label="Dhomat">
        {visibleRooms.map((room) => (
          <button
            key={room.id}
            className={`room-link ${props.activeRoom?.id === room.id ? "active" : ""}`}
            onClick={() => navigate(roomPath(room.slug))}
          >
            <span>{room.name}</span>
            <small>{room.thread_count}</small>
          </button>
        ))}
      </nav>
      {visibleRooms.length === 0 && <p className="rail-empty">Asnje dhome.</p>}
      {props.canCreateRooms && <button className="rail-create" onClick={props.onCreate}><Plus size={15} /> dhome</button>}
    </aside>
  );
}

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

export function MobileDigest(props: { highlights: Message[]; rooms: Room[] }) {
  const hot = useMemo(() => props.highlights.slice(0, 3), [props.highlights]);
  if (hot.length === 0) return null;

  return (
    <aside className="mobile-digest" aria-label="Postime ne fokus">
      {hot.map((message, index) => {
        const room = props.rooms.find((item) => item.id === message.room_id);
        return (
          <button key={message.id} className="mobile-digest-item" onClick={() => navigate(threadPath(message.id))}>
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            <span>{message.body}</span>
            <small>{room?.name || "#sheshi"} · ▲ {message.upvotes} · {message.reply_count} pergjigje</small>
          </button>
        );
      })}
    </aside>
  );
}

export function FocusPanel(props: { highlights: Message[]; rooms: Room[] }) {
  const hot = useMemo(() => props.highlights.slice(0, 5), [props.highlights]);

  return (
    <aside className="focus-panel">
      <div className="panel-head">
        <Flame size={17} />
        <span>NE FOKUS</span>
      </div>
      {hot.length === 0 && <p className="muted">Sapo te kete aktivitet, temat kryesore dalin ketu.</p>}
      {hot.map((message, index) => {
        const room = props.rooms.find((item) => item.id === message.room_id);
        return (
          <button className="focus-item" key={message.id} onClick={() => navigate(threadPath(message.id))}>
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            <span>{message.body}</span>
            <small>{room?.name || "#sheshi"} · ▲ {message.upvotes} · {message.reply_count} pergjigje</small>
          </button>
        );
      })}
    </aside>
  );
}

export function Dialog(props: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onMouseDown={props.onClose}>
      <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <strong>{props.title}</strong>
          <button className="icon-button" onClick={props.onClose}>×</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function ShareDialog(props: { target: ShareTarget; onClose: () => void; onCopy: (target: ShareTarget) => void }) {
  const encodedUrl = encodeURIComponent(props.target.url);
  const encodedText = encodeURIComponent(props.target.text);
  const fullText = encodeURIComponent(`${props.target.text}\n${props.target.url}`);
  const shareOptions = [
    {
      label: "WhatsApp",
      icon: <MessageCircle size={17} />,
      href: `https://wa.me/?text=${fullText}`
    },
    {
      label: "Telegram",
      icon: <Send size={17} />,
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    },
    {
      label: "X",
      icon: <Share2 size={17} />,
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`
    },
    {
      label: "Facebook",
      icon: <Share2 size={17} />,
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
    },
    {
      label: "Email",
      icon: <Mail size={17} />,
      href: `mailto:?subject=${encodeURIComponent(props.target.title)}&body=${fullText}`
    }
  ];

  return (
    <Dialog title="SHPERNDAJ" onClose={props.onClose}>
      <div className="share-sheet">
        <div className="share-preview">
          <span>{props.target.roomName || "SHESHI"}</span>
          <strong>{props.target.text || props.target.title}</strong>
          <small><Link2 size={13} /> {props.target.url}</small>
        </div>
        <div className="share-grid">
          {shareOptions.map((option) => (
            <a
              key={option.label}
              className="share-option"
              href={option.href}
              target="_blank"
              rel="noreferrer"
              onClick={props.onClose}
            >
              {option.icon}
              {option.label}
            </a>
          ))}
          <button className="share-option" type="button" onClick={() => props.onCopy(props.target)}>
            <Copy size={17} />
            Kopjo
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function EmptyState(props: { title: string; action?: string; onAction?: () => void | boolean }) {
  const { action, onAction } = props;
  return (
    <div className="empty-state">
      <h2>{props.title}</h2>
      {action && onAction && (
        <button className="primary-button" onClick={() => onAction()}>{action}</button>
      )}
    </div>
  );
}

export function LoadingRows() {
  return (
    <div className="loading-rows">
      <div />
      <div />
      <div />
    </div>
  );
}
