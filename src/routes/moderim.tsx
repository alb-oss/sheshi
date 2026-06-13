import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sq } from "@/i18n/sq";
import { api, apiJson, apiNoContent } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { Roles, canAdmin, canModerate, hasRole } from "@/lib/roles";
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
};

type ModActor = {
  id: string;
  username: string | null;
  display_name: string | null;
};

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

type MetricBucket = {
  key: string;
  count: number;
};

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

function ModerimPage() {
  const { user, isReady } = useAuth();
  const isModeratorOrAdmin = canModerate(user);
  const isAdmin = canAdmin(user);

  if (!isReady)
    return (
      <AppShell>
        <ModerationShellState
          title="Duke hapur moderimin"
          body={sq.chat.loading}
        />
      </AppShell>
    );
  if (!user) {
    return (
      <AppShell>
        <ModerationShellState title="Hyni për moderim" body={sq.chat.signInToPost}>
          <Button asChild>
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
          body="Ky panel është vetëm për moderatorë dhe administratorë."
        >
          <Button asChild variant="outline">
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
        <div className="border-b border-border pb-4">
          <h1 className="text-2xl font-bold tracking-tight">{sq.nav.admin}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Raporte, flamuj automatikë, metrika dhe veprime mbi përdoruesit në një vend.
          </p>
        </div>
        <Tabs defaultValue="reports" className="mt-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:w-auto sm:grid-cols-none">
            <TabsTrigger value="metrics" className="h-9">
              Metrika
            </TabsTrigger>
            <TabsTrigger value="reports" className="h-9">
              Raporte
            </TabsTrigger>
            <TabsTrigger value="flags" className="h-9">
              Flamuj
            </TabsTrigger>
            <TabsTrigger value="users" className="h-9">
              Përdorues
            </TabsTrigger>
            <TabsTrigger value="actions" className="h-9">
              Log
            </TabsTrigger>
          </TabsList>
          <TabsContent value="metrics" className="mt-4">
            <MetricsPanel />
          </TabsContent>
          <TabsContent value="reports" className="mt-4">
            <ReportsPanel />
          </TabsContent>
          <TabsContent value="flags" className="mt-4">
            <FlagsPanel />
          </TabsContent>
          <TabsContent value="users" className="mt-4">
            <UsersPanel isAdmin={isAdmin} />
          </TabsContent>
          <TabsContent value="actions" className="mt-4">
            <ActionsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function MetricsPanel() {
  const [metrics, setMetrics] = useState<ModerationMetrics | null>(null);

  useEffect(() => {
    apiJson<ModerationMetrics>("/api/mod/metrics")
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, []);

  if (!metrics) {
    return (
      <div className="rounded-sm border border-border p-4 text-sm text-muted-foreground">
        {sq.chat.loading}
      </div>
    );
  }

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
          <div key={card.label} className="rounded-sm border border-border p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {card.label}
            </div>
            <div className="mt-2 text-2xl font-bold">{card.value}</div>
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
    <div className="rounded-sm border border-border p-4">
      <h2 className="text-sm font-bold">{title}</h2>
      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nuk ka të dhëna.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {buckets.map((bucket) => (
            <div key={bucket.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-muted-foreground">{bucket.key}</span>
              <span className="font-bold">{bucket.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatHours(value: number | null) {
  if (value === null) return "-";
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

function severityClass(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-red-500/20 text-red-200";
    case "high":
      return "bg-primary/15 text-primary";
    case "medium":
      return "bg-yellow-500/15 text-yellow-200";
    default:
      return "bg-muted text-muted-foreground";
  }
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
    <label className="flex flex-col gap-1 text-sm text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
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

function ModerationShellState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-xl items-center px-4 py-10">
      <div className="w-full rounded-sm border border-border bg-card/40 p-5">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        {children ? <div className="mt-5 flex flex-wrap gap-2">{children}</div> : null}
      </div>
    </div>
  );
}

function FlagsPanel() {
  const [flags, setFlags] = useState<ModFlag[]>([]);
  const [status, setStatusFilter] = useState("open");
  const [category, setCategory] = useState("all");
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams({ status });
    if (category !== "all") params.set("category", category);

    setIsLoading(true);
    apiJson<ModFlag[]>(`/api/mod/flags?${params.toString()}`)
      .then(setFlags)
      .catch(() => setFlags([]))
      .finally(() => setIsLoading(false));
  }, [status, category]);

  useEffect(() => {
    load();
  }, [load]);

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
        <div className="flex flex-wrap gap-1 rounded-sm bg-muted p-1">
          {reportStatuses.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={status === option.value}
              onClick={() => setStatusFilter(option.value)}
              className={`h-9 rounded-sm px-3 text-sm font-medium transition-colors ${
                status === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-2">
          Kategori
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-9 rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
          >
            {flagCategories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {flags.length === 0 ? (
        <div className="rounded-sm border border-border p-4 text-sm text-muted-foreground">
          {isLoading ? sq.chat.loading : "Nuk ka flamuj automatikë për këta filtra."}
        </div>
      ) : (
        flags.map((flag) => (
          <div key={flag.id} className="rounded-sm border border-border bg-card/20 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-primary">
                    {flag.rule_key}
                  </span>
                  <span className="rounded-sm bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {flag.severity}
                  </span>
                </div>
                <p className="mt-2 text-sm">{flag.evidence}</p>
                <p className="mt-2 text-xs text-muted-foreground">Mesazhi: {flag.message_id}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Button size="sm" className="w-full sm:w-auto" onClick={() => updateFlagStatus(flag.id, "resolve")}>
                  Zgjidh
                </Button>
                <Button size="sm" className="w-full sm:w-auto" variant="outline" onClick={() => updateFlagStatus(flag.id, "dismiss")}>
                  Hidh poshtë
                </Button>
              </div>
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
  const [isLoading, setIsLoading] = useState(false);

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

  useEffect(() => {
    load();
  }, [load]);

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
        <div className="flex flex-wrap gap-1 rounded-sm bg-muted p-1">
          {reportStatuses.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={status === option.value}
              onClick={() => setStatusFilter(option.value)}
              className={`h-9 rounded-sm px-3 text-sm font-medium transition-colors ${
                status === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect label="Arsye" value={reason} onChange={setReason} options={reportReasons} />
          <FilterSelect label="Ashpërsi" value={severity} onChange={setSeverity} options={severityOptions} />
          <FilterSelect label="Rendit" value={sort} onChange={setSort} options={reportSorts} />
          <label className="flex h-9 items-center gap-2 rounded-sm border border-border bg-background px-3 text-sm text-muted-foreground">
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
      {reports.length === 0 ? (
        <div className="rounded-sm border border-border p-4 text-sm text-muted-foreground">
          {isLoading
            ? sq.chat.loading
            : "Nuk ka raporte për këta filtra. Raportet krijohen kur një përdorues i kyçur shtyp flamurin te një mesazh i dikujt tjetër."}
        </div>
      ) : (
        reports.map((report) => (
          <div key={report.id} className="rounded-sm border border-border bg-card/20 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-primary">
                    {report.reason}
                  </span>
                  <span className={`rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${severityClass(report.severity)}`}>
                    {report.severity}
                  </span>
                  <span className="rounded-sm bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    #{report.room_slug}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatAge(report.age_hours)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{report.message_body}</p>
                {report.note ? (
                  <p className="mt-2 rounded-sm border border-border bg-background/50 p-2 text-xs text-muted-foreground">{report.note}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>Autor: {actorLabel(report.author, report.message_author_id)}</span>
                  <span>Raportues: {actorLabel(report.reporter, report.reporter_id)}</span>
                  <span>{report.author_open_report_count} raporte hapur</span>
                  <span>{report.author_open_flag_count} flamuj hapur</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Button size="sm" className="w-full sm:w-auto" onClick={() => updateReportStatus(report.id, "resolve")}>
                  Zgjidh
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => updateReportStatus(report.id, "dismiss")}
                >
                  Hidh poshtë
                </Button>
              </div>
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
  const [isLoading, setIsLoading] = useState(false);

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

  useEffect(() => {
    load();
  }, [load]);

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
        <Button variant="outline" onClick={load} className="h-9 self-end">
          Rifresko
        </Button>
      </div>
      {actions.length === 0 ? (
        <div className="rounded-sm border border-border p-4 text-sm text-muted-foreground">
          {isLoading ? sq.chat.loading : "Nuk ka veprime për këta filtra."}
        </div>
      ) : (
        actions.map((action) => (
          <div key={action.id} className="rounded-sm border border-border bg-card/20 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-primary">
                    {formatActionType(action.action_type)}
                  </span>
                  <span className="rounded-sm bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {action.target_type}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(action.created_at).toLocaleString()}</span>
                </div>
                <div className="mt-2 text-sm">
                  {actorLabel(action.actor, action.actor_id)} → {action.target_id.slice(0, 8)}
                </div>
                {action.reason ? <p className="mt-2 text-xs text-muted-foreground">{action.reason}</p> : null}
                {Object.entries(action.metadata).length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {Object.entries(action.metadata).map(([key, value]) => (
                      <span key={key} className="rounded-sm border border-border px-2 py-1">
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
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

  const search = () => {
    apiJson<ModUser[]>(`/api/mod/users?query=${encodeURIComponent(query)}`)
      .then(setUsers)
      .catch(() => setUsers([]));
  };

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await apiNoContent(`/api/mod/users/${id}/roles`, {
        method: "POST",
        body: { role: Roles.Moderator, grant },
      });
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
          placeholder="Email ose username"
        />
        <Button onClick={search} className="sm:w-auto">
          Kërko
        </Button>
      </div>
      <div className="space-y-2">
        {users.length === 0 ? (
          <div className="rounded-sm border border-border p-4 text-sm text-muted-foreground">
            Nuk ka përdorues për këtë kërkim.
          </div>
        ) : users.map((u) => {
          const isModerator = hasRole(u, Roles.Moderator);
          return (
            <div
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">
                  {u.display_name || u.username || u.email}
                </div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {u.is_banned ? "I bllokuar" : "Aktiv"} · {u.roles.join(", ") || "pa rol"}
                </div>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => post(`/api/mod/users/${u.id}/${u.is_banned ? "unban" : "ban"}`)}
                >
                  {u.is_banned ? "Zhblloko" : "Blloko"}
                </Button>
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
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
    </div>
  );
}
