import { useMemo, useState } from "react";
import { Flame, LogOut, Moon, Plus, Search, ShieldCheck, Sun, UserRound } from "lucide-react";
import { roomPath, threadPath } from "../api";
import { navigate } from "../appSupport";
import type { AuthState, RoomRailMode, Theme } from "../appSupport";
import type { Message, Room } from "../types";

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
