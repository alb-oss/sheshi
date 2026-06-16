import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, ShieldCheck, Trash2, UserX } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sq } from "@/i18n/sq";
import { api, apiJson, apiNoContent } from "@/lib/api-client";
import { ensureRealtimeStarted, invokeRealtime } from "@/lib/realtime";
import { useRealtimeResync } from "@/hooks/use-realtime-resync";
import { useAuth } from "@/hooks/use-auth";
import { Roles, canAdmin, canModerate, hasRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/moderim")({
  head: () => ({ meta: [{ title: "Moderim — Sheshi" }] }),
  component: ModerimPage,
});

type ModReport = {
  id: string;
  message_id: string;
  reporter_id: string;
  reason: string;
  note: string | null;
  status: string;
  message_body: string;
  message_author_id: string;
  room_id: string;
  room_slug: string;
  severity: string;
  created_at: string;
  age_hours: number;
  author_report_count: number;
  author_open_report_count: number;
  author_open_flag_count: number;
  author: ModActor | null;
  reporter: ModActor | null;
  message_author_banned: boolean;
};

type ModActor = { id: string; username: string | null; display_name: string | null };

type ModAction = {
  id: string;
  actor_id: string;
  action_type: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  created_at: string;
  actor: ModActor;
  metadata: Record<string, string>;
};

type ModUser = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  is_banned: boolean;
  roles: string[];
};

type ModFlag = {
  id: string;
  message_id: string;
  room_id: string;
  author_id: string;
  rule_key: string;
  category: string;
  severity: string;
  score: number;
  evidence: string;
  status: string;
  created_at: string;
  message_body: string;
  message_deleted: boolean;
  room_slug: string;
  author: ModActor | null;
  author_banned: boolean;
};

type ModerationMetrics = {
  open_reports: number;
  open_flags: number;
  average_resolution_hours_7d: number | null;
  oldest_open_item_hours: number | null;
  resolved_reports_7d: number;
  bans_7d: number;
  deleted_messages_7d: number;
  reports_by_reason: MetricBucket[];
  flags_by_rule: MetricBucket[];
};

type MetricBucket = { key: string; count: number };

const reportStatuses = [
  { value: "open", label: "Hapur" },
  { value: "resolved", label: "Zgjidhur" },
  { value: "dismissed", label: "Hedhur poshtë" },
];

const reportReasons = [
  { value: "all", label: "Të gjitha arsyet" },
  { value: "spam", label: "Spam" },
  { value: "hate", label: "Urrejtje" },
  { value: "doxxing", label: "Doxxing" },
  { value: "violence", label: "Dhunë" },
  { value: "other", label: "Tjetër" },
];

const severityOptions = [
  { value: "all", label: "Çdo ashpërsi" },
  { value: "low", label: "Low+" },
  { value: "medium", label: "Medium+" },
  { value: "high", label: "High+" },
  { value: "critical", label: "Critical" },
];

const reportSorts = [
  { value: "oldest", label: "Më të vjetrat" },
  { value: "newest", label: "Më të rejat" },
  { value: "severity", label: "Ashpërsi" },
];

const actionTypes = [
  { value: "all", label: "Të gjitha veprimet" },
  { value: "report_resolved", label: "Raport i zgjidhur" },
  { value: "report_dismissed", label: "Raport i hedhur" },
  { value: "flag_resolved", label: "Flamur i zgjidhur" },
  { value: "flag_dismissed", label: "Flamur i hedhur" },
  { value: "message_deleted", label: "Mesazh i fshirë" },
  { value: "user_banned", label: "Bllokim" },
  { value: "user_unbanned", label: "Zhbllokim" },
  { value: "role_granted", label: "Rol i dhënë" },
  { value: "role_removed", label: "Rol i hequr" },
];

const flagCategories = [
  { value: "all", label: "Të gjitha kategoritë" },
  { value: "spam", label: "Spam" },
  { value: "doxxing", label: "Doxxing" },
  { value: "hate", label: "Urrejtje" },
  { value: "violence", label: "Dhunë" },
  { value: "harassment", label: "Ngacmim" },
  { value: "other", label: "Tjetër" },
];

const rowCard = "rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/15";
const emptyBox = "rounded-xl border border-border bg-card/60 p-6 text-center text-sm text-foreground/45";

// Live moderation queue: join the moderator SignalR group and debounce-refetch on any
// report/flag/action change (mod_changed). Used by every panel so the dashboard stays current.
function useModerationLive(reload: () => void) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  // Re-converge the dashboard to server truth after a reconnect or tab-foreground — the mod_changed
  // tick is fire-and-forget, so a moderator who was disconnected/backgrounded would otherwise see a
  // stale queue until they navigated.
  useRealtimeResync(() => reloadRef.current());
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed) reloadRef.current();
      }, 600);
    };
    const conn = ensureRealtimeStarted();
    conn
      .then((c) => {
        if (disposed) return;
        c.on("mod_changed", tick);
        void invokeRealtime("JoinModeration");
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      conn.then((c) => c.off("mod_changed", tick)).catch(() => {});
    };
  }, []);
}

function ModerimPage() {
  const { user, isReady } = useAuth();
  const isModeratorOrAdmin = canModerate(user);
  const isAdmin = canAdmin(user);

  if (!isReady)
    return (
      <AppShell>
        <ModerationShellState title="Duke hapur moderimin" body={sq.chat.loading} />
      </AppShell>
    );
  if (!user) {
    return (
      <AppShell>
        <ModerationShellState title="Hyni për moderim" body={sq.chat.signInToPost}>
          <Button asChild className="rounded-full">
            <Link to="/auth">{sq.auth.signIn}</Link>
          </Button>
        </ModerationShellState>
      </AppShell>
    );
  }
  if (!isModeratorOrAdmin) {
    return (
      <AppShell>
        <ModerationShellState
          title="Nuk keni akses"
          body="Ky panel është vetëm për moderatorë dhe administratorë. Nëse sapo ju është dhënë roli, dilni dhe hyni sërish."
        >
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/dhoma/$slug" params={{ slug: "sheshi" }}>
              Kthehu te #sheshi
            </Link>
          </Button>
        </ModerationShellState>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{sq.nav.admin}</h1>
            <p className="mt-1 max-w-2xl text-sm text-foreground/55">
              {isAdmin
                ? "Si admin: trajto raporte e flamuj, fshi mesazhe, blloko përdorues — dhe cakto kush është moderator."
                : "Si moderator: trajto raporte e flamuj, fshi mesazhe dhe blloko përdorues."}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            {isAdmin ? "Admin" : "Moderator"}
          </span>
        </div>
        <Tabs defaultValue="reports" className="mt-6">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 sm:inline-flex sm:w-auto">
            <TabsTrigger value="metrics" className="h-9">Metrika</TabsTrigger>
            <TabsTrigger value="reports" className="h-9">Raporte</TabsTrigger>
            <TabsTrigger value="flags" className="h-9">Flamuj</TabsTrigger>
            <TabsTrigger value="users" className="h-9">Përdorues</TabsTrigger>
            <TabsTrigger value="actions" className="h-9">Log</TabsTrigger>
          </TabsList>
          <TabsContent value="metrics" className="mt-4"><MetricsPanel /></TabsContent>
          <TabsContent value="reports" className="mt-4"><ReportsPanel /></TabsContent>
          <TabsContent value="flags" className="mt-4"><FlagsPanel /></TabsContent>
          <TabsContent value="users" className="mt-4"><UsersPanel isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="actions" className="mt-4"><ActionsPanel /></TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

// Shared moderator enforcement actions usable on any message (reports + flags).
function useEnforcement(onDone: () => void) {
  async function deleteMessage(id: string) {
    if (!confirm("Fshij këtë mesazh?")) return;
    try {
      await apiNoContent(`/api/messages/${id}`, { method: "DELETE" });
      toast.success("Mesazhi u fshi.");
      onDone();
    } catch {
      toast.error(sq.errors.generic);
    }
  }
  async function banAuthor(id: string) {
    if (!confirm("Blloko autorin e këtij mesazhi?")) return;
    try {
      await api(`/api/mod/users/${id}/ban`, { method: "POST" });
      toast.success("Autori u bllokua.");
      onDone();
    } catch {
      toast.error(sq.errors.generic);
    }
  }
  return { deleteMessage, banAuthor };
}

function EnforcementActions({
  messageId,
  authorId,
  deleted,
  authorBanned,
  onDelete,
  onBan,
}: {
  messageId: string;
  authorId: string;
  deleted?: boolean;
  authorBanned?: boolean;
  onDelete: (id: string) => void;
  onBan: (id: string) => void;
}) {
  const btn =
    "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors";
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        to="/tema/$messageId"
        params={{ messageId }}
        className={cn(btn, "border border-border text-foreground/70 hover:border-primary/40 hover:text-primary")}
      >
        <ExternalLink className="h-3.5 w-3.5" /> Shiko
      </Link>
      {!deleted && (
        <button
          type="button"
          onClick={() => onDelete(messageId)}
          className={cn(btn, "border border-border text-foreground/70 hover:border-primary/40 hover:text-primary")}
        >
          <Trash2 className="h-3.5 w-3.5" /> Fshij mesazhin
        </button>
      )}
      {authorBanned ? (
        <span className={cn(btn, "border border-primary/40 bg-primary/10 text-primary")}>
          <UserX className="h-3.5 w-3.5" /> Autori i bllokuar
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onBan(authorId)}
          className={cn(btn, "border border-border text-foreground/70 hover:border-primary/50 hover:bg-primary/10 hover:text-primary")}
        >
          <UserX className="h-3.5 w-3.5" /> Blloko autorin
        </button>
      )}
    </div>
  );
}

function MetricsPanel() {
  const [metrics, setMetrics] = useState<ModerationMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(() => {
    apiJson<ModerationMetrics>("/api/mod/metrics")
      .then(setMetrics)
      .catch(() => setMetrics(null))
      .finally(() => setIsLoading(false));
  }, []);
  useEffect(() => load(), [load]);
  useModerationLive(load);

  if (isLoading) return <SkeletonGrid />;
  if (!metrics) return <div className={emptyBox}>Metrikat nuk u ngarkuan.</div>;

  const cards = [
    { label: "Raporte të hapura", value: metrics.open_reports },
    { label: "Flamuj të hapur", value: metrics.open_flags },
    { label: "Zgjidhur 7d", value: metrics.resolved_reports_7d },
    { label: "Bllokime 7d", value: metrics.bans_7d },
    { label: "Postime të fshira 7d", value: metrics.deleted_messages_7d },
    { label: "Koha mesatare", value: formatHours(metrics.average_resolution_hours_7d) },
    { label: "Më i vjetri hapur", value: formatHours(metrics.oldest_open_item_hours) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-foreground/45">{card.label}</div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{card.value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <MetricBuckets title="Raporte sipas arsyes" buckets={metrics.reports_by_reason} />
        <MetricBuckets title="Flamuj sipas rregullit" buckets={metrics.flags_by_rule} />
      </div>
    </div>
  );
}

function MetricBuckets({ title, buckets }: { title: string; buckets: MetricBucket[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-bold">{title}</h2>
      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-foreground/45">Nuk ka të dhëna.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {buckets.map((bucket) => (
            <div key={bucket.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-foreground/60">{bucket.key}</span>
              <span className="font-bold tabular-nums">{bucket.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-card" />
      ))}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-card" />
      ))}
    </div>
  );
}

function formatHours(value: number | null) {
  if (value === null) return "—";
  if (value < 1) return `${Math.round(value * 60)}m`;
  return `${value.toFixed(1)}h`;
}

function formatAge(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function actorLabel(actor: ModActor | null | undefined, fallbackId: string) {
  return actor?.display_name || actor?.username || fallbackId.slice(0, 8);
}

function SeverityChip({ severity }: { severity: string }) {
  const cls =
    severity === "critical"
      ? "bg-primary/20 text-primary"
      : severity === "high"
        ? "bg-primary/10 text-primary/90"
        : severity === "medium"
          ? "bg-[color:var(--downvote)]/15 text-[color:var(--downvote)]"
          : "bg-secondary text-foreground/55";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest", cls)}>
      {severity}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-foreground/55">
      {children}
    </span>
  );
}

function BannedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
      <UserX className="h-3 w-3" /> Autor i bllokuar
    </span>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-card p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-8 rounded-md px-3 text-sm font-medium transition-colors",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-foreground/50 hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-foreground/55">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ModerationShellState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-xl items-center px-4 py-10">
      <div className="w-full rounded-2xl border border-border bg-card/50 p-6">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-foreground/55">{body}</p>
        {children ? <div className="mt-5 flex flex-wrap gap-2">{children}</div> : null}
      </div>
    </div>
  );
}

function FlagsPanel() {
  const [flags, setFlags] = useState<ModFlag[]>([]);
  const [status, setStatusFilter] = useState("open");
  const [category, setCategory] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(() => {
    const params = new URLSearchParams({ status });
    if (category !== "all") params.set("category", category);
    setIsLoading(true);
    apiJson<ModFlag[]>(`/api/mod/flags?${params.toString()}`)
      .then(setFlags)
      .catch(() => setFlags([]))
      .finally(() => setIsLoading(false));
  }, [status, category]);

  useEffect(() => load(), [load]);
  useModerationLive(load);
  const { deleteMessage, banAuthor } = useEnforcement(load);

  async function updateFlagStatus(id: string, action: "resolve" | "dismiss") {
    try {
      await api(`/api/mod/flags/${id}/${action}`, { method: "POST" });
      load();
    } catch {
      toast.error(sq.errors.generic);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented value={status} onChange={setStatusFilter} options={reportStatuses} />
        <label className="flex items-center gap-2 text-sm text-foreground/55">
          Kategori
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-ring"
          >
            {flagCategories.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      {isLoading ? (
        <SkeletonRows />
      ) : flags.length === 0 ? (
        <div className={emptyBox}>Nuk ka flamuj automatikë për këta filtra.</div>
      ) : (
        flags.map((flag) => (
          <div key={flag.id} className={rowCard}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-primary">{flag.rule_key}</span>
              <SeverityChip severity={flag.severity} />
              <Chip>#{flag.room_slug}</Chip>
              {flag.author_banned ? <BannedBadge /> : null}
              <span className="text-xs text-foreground/45">{flag.evidence}</span>
            </div>
            <p className={cn("mt-2 whitespace-pre-wrap break-words text-sm", flag.message_deleted ? "italic text-foreground/40" : "text-foreground/90")}>
              {flag.message_deleted ? sq.chat.deleted : flag.message_body || "—"}
            </p>
            <div className="mt-2 text-xs text-foreground/45">Autor: {actorLabel(flag.author, flag.author_id)}</div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <EnforcementActions
                messageId={flag.message_id}
                authorId={flag.author_id}
                deleted={flag.message_deleted}
                authorBanned={flag.author_banned}
                onDelete={deleteMessage}
                onBan={banAuthor}
              />
              {flag.status === "open" && (
                <div className="flex gap-2">
                  <Button size="sm" className="rounded-full" onClick={() => updateFlagStatus(flag.id, "resolve")}>Zgjidh</Button>
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => updateFlagStatus(flag.id, "dismiss")}>Hidh poshtë</Button>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ReportsPanel() {
  const [reports, setReports] = useState<ModReport[]>([]);
  const [status, setStatusFilter] = useState("open");
  const [reason, setReason] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [sort, setSort] = useState("oldest");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(() => {
    const params = new URLSearchParams({ status });
    if (reason !== "all") params.set("reason", reason);
    if (severity !== "all") params.set("min_severity", severity);
    if (repeatOnly) params.set("repeat_offender", "true");
    params.set("sort", sort);
    setIsLoading(true);
    apiJson<ModReport[]>(`/api/mod/reports?${params.toString()}`)
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setIsLoading(false));
  }, [status, reason, severity, repeatOnly, sort]);

  useEffect(() => load(), [load]);
  useModerationLive(load);
  const { deleteMessage, banAuthor } = useEnforcement(load);

  async function updateReportStatus(id: string, action: "resolve" | "dismiss") {
    try {
      await api(`/api/mod/reports/${id}/${action}`, { method: "POST" });
      load();
    } catch {
      toast.error(sq.errors.generic);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 border-b border-border pb-3">
        <Segmented value={status} onChange={setStatusFilter} options={reportStatuses} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect label="Arsye" value={reason} onChange={setReason} options={reportReasons} />
          <FilterSelect label="Ashpërsi" value={severity} onChange={setSeverity} options={severityOptions} />
          <FilterSelect label="Rendit" value={sort} onChange={setSort} options={reportSorts} />
          <label className="flex h-9 items-center gap-2 self-end rounded-lg border border-border bg-secondary px-3 text-sm text-foreground/55">
            <input
              type="checkbox"
              checked={repeatOnly}
              onChange={(event) => setRepeatOnly(event.target.checked)}
              className="size-4 accent-primary"
            />
            Repeat offender
          </label>
        </div>
      </div>
      {isLoading ? (
        <SkeletonRows />
      ) : reports.length === 0 ? (
        <div className={emptyBox}>
          Nuk ka raporte për këta filtra. Raportet krijohen kur një përdorues raporton mesazhin e dikujt tjetër.
        </div>
      ) : (
        reports.map((report) => (
          <div key={report.id} className={rowCard}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-primary">{report.reason}</span>
              <SeverityChip severity={report.severity} />
              <Chip>#{report.room_slug}</Chip>
              {report.message_author_banned ? <BannedBadge /> : null}
              <span className="text-xs text-foreground/45">{formatAge(report.age_hours)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground/90">{report.message_body}</p>
            {report.note ? (
              <p className="mt-2 rounded-lg border border-border bg-background/50 p-2 text-xs text-foreground/55">{report.note}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-foreground/45">
              <span>Autor: {actorLabel(report.author, report.message_author_id)}</span>
              <span>Raportues: {actorLabel(report.reporter, report.reporter_id)}</span>
              <span>{report.author_open_report_count} raporte hapur</span>
              <span>{report.author_open_flag_count} flamuj hapur</span>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <EnforcementActions
                messageId={report.message_id}
                authorId={report.message_author_id}
                authorBanned={report.message_author_banned}
                onDelete={deleteMessage}
                onBan={banAuthor}
              />
              {report.status === "open" && (
                <div className="flex gap-2">
                  <Button size="sm" className="rounded-full" onClick={() => updateReportStatus(report.id, "resolve")}>Zgjidh</Button>
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => updateReportStatus(report.id, "dismiss")}>Hidh poshtë</Button>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ActionsPanel() {
  const [actions, setActions] = useState<ModAction[]>([]);
  const [actionType, setActionType] = useState("all");
  const [targetType, setTargetType] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (actionType !== "all") params.set("action_type", actionType);
    if (targetType !== "all") params.set("target_type", targetType);
    setIsLoading(true);
    apiJson<ModAction[]>(`/api/mod/actions?${params.toString()}`)
      .then(setActions)
      .catch(() => setActions([]))
      .finally(() => setIsLoading(false));
  }, [actionType, targetType]);

  useEffect(() => load(), [load]);
  useModerationLive(load);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 border-b border-border pb-3 sm:grid-cols-2 lg:grid-cols-3">
        <FilterSelect label="Veprim" value={actionType} onChange={setActionType} options={actionTypes} />
        <FilterSelect
          label="Objekt"
          value={targetType}
          onChange={setTargetType}
          options={[
            { value: "all", label: "Të gjitha objektet" },
            { value: "report", label: "Raport" },
            { value: "flag", label: "Flamur" },
            { value: "message", label: "Mesazh" },
            { value: "user", label: "Përdorues" },
            { value: "role", label: "Rol" },
            { value: "room", label: "Dhomë" },
          ]}
        />
        <Button variant="outline" onClick={load} className="h-9 self-end rounded-full">Rifresko</Button>
      </div>
      {isLoading ? (
        <SkeletonRows />
      ) : actions.length === 0 ? (
        <div className={emptyBox}>Nuk ka veprime për këta filtra.</div>
      ) : (
        actions.map((action) => (
          <div key={action.id} className={rowCard}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-primary">{formatActionType(action.action_type)}</span>
              <Chip>{action.target_type}</Chip>
              <span className="text-xs text-foreground/45">{new Date(action.created_at).toLocaleString()}</span>
            </div>
            <div className="mt-2 text-sm">
              {actorLabel(action.actor, action.actor_id)} → {action.target_id.slice(0, 8)}
            </div>
            {action.reason ? <p className="mt-2 text-xs text-foreground/45">{action.reason}</p> : null}
            {Object.entries(action.metadata).length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-foreground/45">
                {Object.entries(action.metadata).map(([key, value]) => (
                  <span key={key} className="rounded-full border border-border px-2 py-1">{key}: {value}</span>
                ))}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

function formatActionType(value: string) {
  return value.replaceAll("_", " ");
}

function UsersPanel({ isAdmin }: { isAdmin: boolean }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<ModUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const search = useCallback(() => {
    setIsLoading(true);
    apiJson<ModUser[]>(`/api/mod/users?query=${encodeURIComponent(query)}`)
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setIsLoading(false));
  }, [query]);

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useModerationLive(search);

  async function post(path: string) {
    try {
      await api(path, { method: "POST" });
      search();
    } catch {
      toast.error(sq.errors.generic);
    }
  }

  async function updateModerator(id: string, grant: boolean) {
    try {
      await apiNoContent(`/api/mod/users/${id}/roles`, { method: "POST", body: { role: Roles.Moderator, grant } });
      search();
    } catch {
      toast.error(sq.errors.generic);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Email ose username"
          className="rounded-xl"
        />
        <Button onClick={search} className="rounded-full sm:w-auto">Kërko</Button>
      </div>
      {isAdmin ? (
        <p className="text-xs text-foreground/45">
          Vetëm admini cakton moderatorë. Roli zë vend pasi përdoruesi rihyn.
        </p>
      ) : null}
      {isLoading ? (
        <SkeletonRows />
      ) : users.length === 0 ? (
        <div className={emptyBox}>Nuk ka përdorues për këtë kërkim.</div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const isModerator = hasRole(u, Roles.Moderator);
            return (
              <div key={u.id} className={cn(rowCard, "flex flex-wrap items-center justify-between gap-3")}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{u.display_name || u.username || u.email}</div>
                  <div className="text-xs text-foreground/45">{u.email}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Chip>{u.is_banned ? "I bllokuar" : "Aktiv"}</Chip>
                    {u.roles.length ? u.roles.map((r) => <Chip key={r}>{r}</Chip>) : <Chip>qytetar</Chip>}
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-full sm:w-auto"
                    onClick={() => post(`/api/mod/users/${u.id}/${u.is_banned ? "unban" : "ban"}`)}
                  >
                    {u.is_banned ? "Zhblloko" : "Blloko"}
                  </Button>
                  {isAdmin ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full rounded-full sm:w-auto"
                      onClick={() => updateModerator(u.id, !isModerator)}
                    >
                      {isModerator ? "Hiq moderator" : "Bëj moderator"}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
