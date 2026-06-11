import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Ban,
  BarChart3,
  Check,
  Flag,
  Loader2,
  MessageSquare,
  ShieldCheck,
  UserCog,
  Users
} from "lucide-react";
import type { Chart as ChartInstance } from "chart.js";
import { api, ApiError, threadPath } from "../api";
import { navigate } from "../appSupport";
import type { AuthState } from "../appSupport";
import type { ModAnalytics, ModReport, ModUser, TrendPoint } from "../types";
import { EmptyState, LoadingRows } from "../components/overlays";

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

function AdminOverview(props: { analytics: ModAnalytics | null; loading: boolean; token?: string | null }) {
  const analytics = props.analytics;
  const [range, setRange] = useState<7 | 30>(7);
  const [history, setHistory] = useState<TrendPoint[] | null>(null);
  const token = props.token;

  useEffect(() => {
    if (range !== 30 || !token) return;
    let active = true;
    api.modAnalyticsHistory({ token, days: 30 })
      .then((points) => { if (active) setHistory(points); })
      .catch(() => { if (active) setHistory(null); });
    return () => { active = false; };
  }, [range, token]);

  if (!analytics && props.loading) return <LoadingRows />;
  if (!analytics) return <p className="muted admin-empty">Analitika nuk u ngarkua.</p>;

  const trend = range === 30 && history ? history : analytics.trend;

  const health = analytics.moderation_health;
  const statCards = [
    { label: "Perdorues", value: analytics.totals.users, sub: `+${analytics.last24_hours.users} / 24h`, icon: <Users size={18} /> },
    { label: "Aktive / jave", value: analytics.active_users.weekly, sub: `${analytics.active_users.daily} sot · ${analytics.active_users.monthly} / muaj`, icon: <Activity size={18} /> },
    { label: "Tema", value: analytics.totals.threads, sub: growthLabel(analytics.growth.messages), icon: <MessageSquare size={18} /> },
    { label: "Pergjigje", value: analytics.totals.replies, sub: `${analytics.engagement.answered_threads_pct}% tema me pergjigje`, icon: <Check size={18} /> },
    { label: "Vota", value: analytics.totals.votes, sub: growthLabel(analytics.growth.votes), icon: <BarChart3 size={18} /> },
    { label: "Raporte hapur", value: analytics.reports.open, sub: health.avg_resolution_hours == null ? "pa zgjidhje ende" : `~${health.avg_resolution_hours}h per zgjidhje`, icon: <Flag size={18} /> },
    { label: "Banned", value: analytics.users.banned, sub: `${analytics.users.admins} admin · ${analytics.users.moderators} mod`, icon: <Ban size={18} /> },
    { label: "Fshirje", value: `${health.deletion_rate_pct}%`, sub: `${health.reports_per_thousand_messages} raporte / 1k`, icon: <ShieldCheck size={18} /> }
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
          <div className="admin-panel-head">
            <div>
              <span className="section-label"><BarChart3 size={18} />{range === 30 ? "30 DITE" : "7 DITE"}</span>
              <h2>Aktiviteti</h2>
            </div>
            <div className="tabs compact-tabs">
              <button className={range === 7 ? "active" : ""} onClick={() => setRange(7)}>7d</button>
              <button className={range === 30 ? "active" : ""} onClick={() => setRange(30)}>30d</button>
            </div>
          </div>
          <AnalyticsChart trend={trend} />
        </section>

        <section className="admin-panel analytics-panel">
          <AdminPanelHead icon={<Flag size={18} />} label="STATUS" title="Raporte" />
          <div className="report-meters">
            <Meter label="Hapur" value={analytics.reports.open} total={analytics.totals.reports} />
            <Meter label="Zgjidhur" value={analytics.reports.resolved} total={analytics.totals.reports} />
            <Meter label="Hequr" value={analytics.reports.dismissed} total={analytics.totals.reports} />
          </div>
          {health.open_backlog_avg_age_hours != null && (
            <p className="muted admin-empty">Mosha mesatare e radhes: ~{health.open_backlog_avg_age_hours}h</p>
          )}
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
          title="Autoret kryesore"
          label="AUTORE"
          rows={analytics.top_authors.map((author) => ({
            key: author.id,
            primary: author.author,
            secondary: "kontribues",
            value: `${author.messages} postime`
          }))}
        />
      </div>

      <div className="admin-analytics-grid">
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

// Signed week-over-week change, e.g. "+12% / jave" or "i ri" when there's no baseline.
function growthLabel(point: { current: number; previous: number }): string {
  if (point.previous === 0) return point.current > 0 ? "i ri / jave" : "—";
  const pct = Math.round(((point.current - point.previous) / point.previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% / jave`;
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

function AnalyticsChart(props: { trend: TrendPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    let disposed = false;
    let chart: ChartInstance<"line", number[], string> | undefined;

    const labels = props.trend.map((point) => point.date);

    void loadChartJs().then(({ Chart }) => {
      if (disposed || !canvasRef.current) return;
      chart = new Chart(canvasRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Postime",
              data: props.trend.map((point) => point.messages),
              borderColor: "#ef4d55",
              backgroundColor: "rgba(239, 77, 85, 0.14)",
              fill: true,
              tension: 0.35
            },
            {
              label: "Vota",
              data: props.trend.map((point) => point.votes),
              borderColor: "#4f8cff",
              backgroundColor: "rgba(79, 140, 255, 0.1)",
              tension: 0.35
            },
            {
              label: "Raporte",
              data: props.trend.map((point) => point.reports),
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
  }, [props.trend]);

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
