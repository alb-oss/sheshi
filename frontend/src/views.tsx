import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  Ban,
  BarChart3,
  Check,
  Flag,
  Loader2,
  MessageSquare,
  Plus,
  ShieldCheck,
  UserCog,
  Users
} from "lucide-react";
import type { Chart as ChartInstance } from "chart.js";
import { api, ApiError, roomPath, threadPath } from "./api";
import {
  displayName,
  findReplyNode,
  navigate,
  sortHomeThreads
} from "./appSupport";
import type { AuthState, HomeSort } from "./appSupport";
import type { Message, ModAnalytics, ModReport, ModUser, Room, Thread } from "./types";
import {
  Composer,
  Dialog,
  EmptyState,
  LoadingRows,
  ReplyComposer,
  ReplyTree,
  ThreadCard
} from "./ui";

let chartJsModule: Promise<typeof import("chart.js")> | null = null;

function loadChartJs() {
  chartJsModule ??= import("chart.js").then((mod) => {
    mod.Chart.register(
      mod.BarController,
      mod.BarElement,
      mod.CategoryScale,
      mod.Filler,
      mod.Legend,
      mod.LinearScale,
      mod.LineController,
      mod.LineElement,
      mod.PointElement,
      mod.Tooltip
    );
    return mod;
  });
  return chartJsModule;
}


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

export function AuthPage(props: {
  providers: string[];
  onExternal: (provider: string) => void;
  onLogin: (email: string, password: string) => void;
  onRegister: (email: string, password: string, displayName: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const actionLabel = mode === "login" ? "HYR" : "REGJISTROHU";

  function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "login") props.onLogin(email, password);
    else props.onRegister(email, password, displayName || email.split("@")[0]);
  }

  return (
    <section className="auth-card compact">
      {props.providers.includes("google") && (
        <>
          <button className="oauth-button" type="button" onClick={() => props.onExternal("google")}>
            <span className="google-mark">G</span>
            VAZHDO ME GOOGLE
          </button>
          <div className="auth-divider"><span>ose</span></div>
        </>
      )}
      <div className="tabs">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>HYR</button>
        <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>REGJISTROHU</button>
      </div>
      <form className="auth-form" onSubmit={submitAuth}>
        {mode === "register" && (
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Emri publik"
            autoComplete="name"
          />
        )}
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" autoComplete="email" />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Fjalekalimi"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        <button className="primary-button full auth-submit" type="submit">
          <Check size={16} /> {actionLabel}
        </button>
      </form>
    </section>
  );
}

export function AuthCallback(props: { status: "idle" | "loading" | "failed"; onAuth: () => void }) {
  return (
    <section className="auth-card auth-callback">
      {props.status !== "failed" ? <Loader2 size={22} className="spin" /> : null}
      <h1>{props.status === "failed" ? "Hyrja deshtoi" : "Duke hyre"}</h1>
      <p className="muted">
        {props.status === "failed"
          ? "Provo perseri ose hyr me email."
          : "Po lidhim llogarine tende me Sheshi."}
      </p>
      {props.status === "failed" && <button className="primary-button" onClick={props.onAuth}>KTHEHU TE HYRJA</button>}
    </section>
  );
}

export function Profile(props: {
  auth: AuthState;
  canModerate: boolean;
  canCreateRooms: boolean;
  onAuth: () => void;
  onCreate: () => void;
  onLogout: () => void;
}) {
  if (!props.auth) return <EmptyState title="Nuk je hyre" action="HYR" onAction={props.onAuth} />;
  return (
    <section className="profile-card">
      <div className="avatar">{(props.auth.user.display_name || props.auth.user.username || "S").slice(0, 1).toUpperCase()}</div>
      <h1>{props.auth.user.display_name || props.auth.user.username}</h1>
      <p>{props.auth.user.email}</p>
      <div className="profile-roles" aria-label="Rolet">
        {props.auth.user.roles.map((role) => <span key={role}>{role}</span>)}
      </div>
      {(props.canModerate || props.canCreateRooms) && (
        <div className="profile-admin-actions">
          {props.canModerate && (
            <button className="primary-button" onClick={() => navigate("/moderim")}>
              <ShieldCheck size={16} /> MODERIM
            </button>
          )}
          {props.canCreateRooms && (
            <button className="ghost-button" onClick={props.onCreate}>
              <Plus size={16} /> KRIJO DHOME
            </button>
          )}
        </div>
      )}
      <button className="primary-button" onClick={props.onLogout}>DIL</button>
    </section>
  );
}

export function ModerationView(props: {
  auth: AuthState;
  canModerate: boolean;
  canAdmin: boolean;
  onAuth: () => void;
  onError: (message: string) => void;
}) {
  const [activePanel, setActivePanel] = useState<"overview" | "reports" | "users">("overview");
  const [analytics, setAnalytics] = useState<ModAnalytics | null>(null);
  const [reports, setReports] = useState<ModReport[]>([]);
  const [users, setUsers] = useState<ModUser[]>([]);
  const [reportStatus, setReportStatus] = useState<"open" | "resolved" | "dismissed">("open");
  const [query, setQuery] = useState("");
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const token = props.auth?.token;

  async function loadAnalytics() {
    if (!token) return;
    setLoadingAnalytics(true);
    try {
      setAnalytics(await api.modAnalytics({ token }));
    } catch (error) {
      props.onError(error instanceof ApiError ? error.message : "Analitika nuk u ngarkua.");
    } finally {
      setLoadingAnalytics(false);
    }
  }

  async function loadReports(status = reportStatus) {
    if (!token) return;
    setLoadingReports(true);
    try {
      setReports(await api.modReports({ token, status }));
    } catch (error) {
      props.onError(error instanceof ApiError ? error.message : "Raportet nuk u ngarkuan.");
    } finally {
      setLoadingReports(false);
    }
  }

  async function loadUsers(search = query) {
    if (!token) return;
    setLoadingUsers(true);
    try {
      setUsers(await api.modUsers({ token, query: search }));
    } catch (error) {
      props.onError(error instanceof ApiError ? error.message : "Perdoruesit nuk u ngarkuan.");
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    if (!token || !props.canModerate) return;
    void loadAnalytics();
    void loadReports(reportStatus);
  }, [token, props.canModerate, reportStatus]);

  useEffect(() => {
    if (!token || !props.canModerate) return;
    void loadUsers("");
  }, [token, props.canModerate]);

  useEffect(() => {
    if (!token || !props.canModerate) return;
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void loadAnalytics();
      if (activePanel === "reports") void loadReports(reportStatus);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [activePanel, token, props.canModerate, reportStatus]);

  async function actOnReport(report: ModReport, action: "resolve" | "dismiss" | "delete") {
    if (!token) return;
    try {
      if (action === "resolve") await api.resolveReport({ token, id: report.id });
      if (action === "dismiss") await api.dismissReport({ token, id: report.id });
      if (action === "delete") {
        await api.deleteMessage({ token, id: report.message_id });
        await api.resolveReport({ token, id: report.id });
      }
      await loadReports();
      await loadAnalytics();
    } catch (error) {
      props.onError(error instanceof ApiError ? error.message : "Veprimi deshtoi.");
    }
  }

  async function actOnUser(user: ModUser, action: "ban" | "unban" | "grantMod" | "revokeMod") {
    if (!token) return;
    try {
      if (action === "ban") await api.banUser({ token, id: user.id });
      if (action === "unban") await api.unbanUser({ token, id: user.id });
      if (action === "grantMod") await api.setModerator({ token, id: user.id, grant: true });
      if (action === "revokeMod") await api.setModerator({ token, id: user.id, grant: false });
      await loadUsers();
      await loadAnalytics();
    } catch (error) {
      props.onError(error instanceof ApiError ? error.message : "Veprimi deshtoi.");
    }
  }

  if (!props.auth) return <EmptyState title="Duhet te hysh si admin" action="HYR" onAction={props.onAuth} />;
  if (!props.canModerate) return <EmptyState title="Nuk ke akses moderimi" action="Kthehu" onAction={() => navigate("/")} />;

  return (
    <section className="moderation-view admin-workspace">
      <div className="admin-command">
        <div className="admin-title-block">
          <p className="crumb">ADMIN CONSOLE</p>
          <h1>Paneli admin</h1>
          <p className="muted">Puls live per postime, vota, raporte dhe perdorues.</p>
        </div>
        <div className="admin-command-metrics" aria-label="Admin snapshot">
          <span><strong>{analytics?.totals.messages ?? "-"}</strong> postime</span>
          <span><strong>{analytics?.totals.votes ?? "-"}</strong> vota</span>
          <span><strong>{analytics?.reports.open ?? "-"}</strong> raporte hapur</span>
        </div>
        <div className="admin-hero-actions">
          {loadingAnalytics && <Loader2 className="spin" size={18} />}
          <button className="ghost-button" onClick={() => {
            void loadAnalytics();
            void loadReports(reportStatus);
            void loadUsers(query);
          }}>
            Rifresko
          </button>
          <span className="live-pill">{props.canAdmin ? "admin" : "moderator"}</span>
        </div>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        <button className={activePanel === "overview" ? "active" : ""} onClick={() => setActivePanel("overview")}>
          <BarChart3 size={16} /> Puls
        </button>
        <button className={activePanel === "reports" ? "active" : ""} onClick={() => setActivePanel("reports")}>
          <Flag size={16} /> Raporte
          {analytics?.reports.open ? <strong>{analytics.reports.open}</strong> : null}
        </button>
        <button className={activePanel === "users" ? "active" : ""} onClick={() => setActivePanel("users")}>
          <Users size={16} /> Perdorues
        </button>
      </div>

      {activePanel === "overview" && <AdminOverview analytics={analytics} loading={loadingAnalytics} />}

      {activePanel === "reports" && (
        <section className="admin-panel admin-room">
          <AdminPanelHead icon={<Flag size={18} />} label="QUEUE" title="Raportet" loading={loadingReports} />
          <div className="tabs compact-tabs admin-status-tabs">
            {(["open", "resolved", "dismissed"] as const).map((status) => (
              <button key={status} className={reportStatus === status ? "active" : ""} onClick={() => setReportStatus(status)}>
                {status}
              </button>
            ))}
          </div>
          <div className="admin-list moderation-room-list">
            {reports.length === 0 && <p className="muted admin-empty">Asnje raport.</p>}
            {reports.map((report) => (
              <article className="admin-card report-card" key={report.id}>
                <div className="admin-card-meta">
                  <strong>{report.reason}</strong>
                  <span>{report.status}</span>
                </div>
                <p>{report.message_body || "Mesazh bosh"}</p>
                {report.note && <small>Note: {report.note}</small>}
                <div className="admin-actions">
                  <button className="ghost-button" onClick={() => navigate(threadPath(report.message_id))}>HAP TEMEN</button>
                  {report.status === "open" && <button className="ghost-button" onClick={() => actOnReport(report, "dismiss")}>HIQ</button>}
                  {report.status === "open" && <button className="primary-button" onClick={() => actOnReport(report, "resolve")}><Check size={15} /> ZGJIDH</button>}
                  {report.status === "open" && <button className="danger-button" onClick={() => actOnReport(report, "delete")}><Ban size={15} /> FSHEH</button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {activePanel === "users" && (
        <section className="admin-panel user-control-room">
          <AdminPanelHead icon={<UserCog size={18} />} label="PERDORUES" title="Kontrolle" loading={loadingUsers} />
          <form className="admin-search" onSubmit={(event) => {
            event.preventDefault();
            void loadUsers(query);
          }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Kerko email ose username"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="primary-button" type="submit">KERKO</button>
          </form>
          <div className="admin-list user-grid">
            {users.length === 0 && <p className="muted admin-empty">Asnje perdorues.</p>}
            {users.map((user) => {
              const isModerator = user.roles.includes("moderator");
              const isAdmin = user.roles.includes("admin");
              const isSelf = props.auth?.user.id === user.id;
              return (
                <article className="admin-card user-card" key={user.id}>
                  <div className="admin-card-meta">
                    <strong>{user.display_name || user.username || user.email || "anon"}</strong>
                    <span>{user.is_banned ? "banned" : user.roles.join(", ") || "user"}</span>
                  </div>
                  <small>{user.email || user.username}</small>
                  <div className="admin-actions">
                    <button
                      className="ghost-button"
                      disabled={isSelf}
                      onClick={() => actOnUser(user, user.is_banned ? "unban" : "ban")}
                    >
                      <Ban size={15} /> {user.is_banned ? "UNBAN" : "BAN"}
                    </button>
                    {props.canAdmin && !isAdmin && (
                      <button className="ghost-button" onClick={() => actOnUser(user, isModerator ? "revokeMod" : "grantMod")}>
                        {isModerator ? <UserCog size={15} /> : <ShieldCheck size={15} />}
                        {isModerator ? "HIQ MOD" : "BEJ MOD"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}

function AdminOverview(props: { analytics: ModAnalytics | null; loading: boolean }) {
  const analytics = props.analytics;
  if (!analytics && props.loading) return <LoadingRows />;
  if (!analytics) return <p className="muted admin-empty">Analitika nuk u ngarkua.</p>;

  const statCards = [
    { label: "Perdorues", value: analytics.totals.users, sub: `+${analytics.last24_hours.users} / 24h`, icon: <Users size={18} /> },
    { label: "Tema", value: analytics.totals.threads, sub: `+${analytics.last24_hours.threads} / 24h`, icon: <MessageSquare size={18} /> },
    { label: "Pergjigje", value: analytics.totals.replies, sub: `+${analytics.last24_hours.replies} / 24h`, icon: <Activity size={18} /> },
    { label: "Vota", value: analytics.totals.votes, sub: `+${analytics.last24_hours.votes} / 24h`, icon: <BarChart3 size={18} /> },
    { label: "Raporte hapur", value: analytics.reports.open, sub: `${analytics.reports.resolved} resolved`, icon: <Flag size={18} /> },
    { label: "Banned", value: analytics.users.banned, sub: `${analytics.users.admins} admin / ${analytics.users.moderators} mod`, icon: <Ban size={18} /> }
  ];

  return (
    <div className="admin-overview">
      <div className="admin-stat-grid">
        {statCards.map((card) => (
          <article className="admin-stat-card" key={card.label}>
            <span>{card.icon}</span>
            <strong>{card.value}</strong>
            <p>{card.label}</p>
            <small>{card.sub}</small>
          </article>
        ))}
      </div>

      <div className="admin-analytics-grid">
        <section className="admin-panel analytics-panel wide">
          <AdminPanelHead icon={<BarChart3 size={18} />} label="7 DITE" title="Aktiviteti" />
          <AnalyticsChart analytics={analytics} />
        </section>

        <section className="admin-panel analytics-panel">
          <AdminPanelHead icon={<Flag size={18} />} label="STATUS" title="Raporte" />
          <div className="report-meters">
            <Meter label="Hapur" value={analytics.reports.open} total={analytics.totals.reports} />
            <Meter label="Zgjidhur" value={analytics.reports.resolved} total={analytics.totals.reports} />
            <Meter label="Hequr" value={analytics.reports.dismissed} total={analytics.totals.reports} />
          </div>
        </section>
      </div>

      <div className="admin-analytics-grid">
        <AdminDataTable
          title="Dhomat aktive"
          label="DHOMA"
          rows={analytics.top_rooms.map((room) => ({
            key: room.id,
            primary: room.name,
            secondary: `${room.threads} tema · ${room.replies} pergjigje · ${room.votes} vota`,
            value: `${room.reports} raporte`
          }))}
        />
        <AdminDataTable
          title="Postimet kryesore"
          label="POSTIME"
          rows={analytics.top_posts.map((post) => ({
            key: post.id,
            primary: post.body || "Mesazh bosh",
            secondary: `${post.room_name} · ${post.author} · ${post.depth > 0 ? "pergjigje" : "teme"}`,
            value: `▲ ${post.upvotes} · ${post.replies} pergjigje`,
            onClick: () => navigate(threadPath(post.id))
          }))}
        />
      </div>
    </div>
  );
}

function AdminPanelHead(props: { icon: ReactNode; label: string; title: string; loading?: boolean }) {
  return (
    <div className="admin-panel-head">
      <div>
        <span className="section-label">{props.icon}{props.label}</span>
        <h2>{props.title}</h2>
      </div>
      {props.loading && <Loader2 className="spin" size={18} />}
    </div>
  );
}

function AnalyticsChart(props: { analytics: ModAnalytics }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    let disposed = false;
    let chart: ChartInstance<"line", number[], string> | undefined;

    const labels = props.analytics.trend.map((point) => point.date);

    void loadChartJs().then(({ Chart }) => {
      if (disposed || !canvasRef.current) return;
      chart = new Chart(canvasRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Postime",
              data: props.analytics.trend.map((point) => point.messages),
              borderColor: "#ef4d55",
              backgroundColor: "rgba(239, 77, 85, 0.14)",
              fill: true,
              tension: 0.35
            },
            {
              label: "Vota",
              data: props.analytics.trend.map((point) => point.votes),
              borderColor: "#4f8cff",
              backgroundColor: "rgba(79, 140, 255, 0.1)",
              tension: 0.35
            },
            {
              label: "Raporte",
              data: props.analytics.trend.map((point) => point.reports),
              borderColor: "#f2b84b",
              backgroundColor: "rgba(242, 184, 75, 0.1)",
              tension: 0.35
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } },
            tooltip: { displayColors: true }
          },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { precision: 0 } }
          }
        }
      });
    });

    return () => {
      disposed = true;
      chart?.destroy();
    };
  }, [props.analytics]);

  return <div className="analytics-chart"><canvas ref={canvasRef} /></div>;
}

function Meter(props: { label: string; value: number; total: number }) {
  const width = props.total <= 0 ? 0 : Math.round((props.value / props.total) * 100);
  return (
    <div className="meter">
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
      </div>
      <i><b style={{ width: `${width}%` }} /></i>
    </div>
  );
}

function AdminDataTable(props: {
  label: string;
  title: string;
  rows: Array<{ key: string; primary: string; secondary: string; value: string; onClick?: () => void }>;
}) {
  return (
    <section className="admin-panel data-panel">
      <AdminPanelHead icon={<BarChart3 size={18} />} label={props.label} title={props.title} />
      <div className="data-list">
        {props.rows.length === 0 && <p className="muted admin-empty">Pa te dhena.</p>}
        {props.rows.map((row) => (
          <button type="button" key={row.key} className="data-row" onClick={row.onClick} disabled={!row.onClick}>
            <span>
              <strong>{row.primary}</strong>
              <small>{row.secondary}</small>
            </span>
            <em>{row.value}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

export function CreateRoomDialog(props: { token: string; onClose: () => void; onCreated: (room: Room) => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function create() {
    try {
      props.onCreated(await api.createRoom({ token: props.token, input: { name, description } }));
    } catch (error) {
      props.onError(error instanceof ApiError ? error.message : "Dhoma nuk u krijua.");
    }
  }

  return (
    <Dialog title="KRIJO DHOME" onClose={props.onClose}>
      <div className="form-stack">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="#emri" />
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Pershkrim i shkurter" />
        <button className="primary-button full" disabled={!name.trim()} onClick={create}><Plus size={16} /> KRIJO</button>
      </div>
    </Dialog>
  );
}
