import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sq } from "@/i18n/sq";
import { api, apiJson } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
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
};

type ModUser = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  is_banned: boolean;
  roles: string[];
};

function ModerimPage() {
  const { user, isReady } = useAuth();
  const canModerate = !!user?.roles.some((role) => role === "moderator" || role === "admin");
  const isAdmin = !!user?.roles.includes("admin");

  if (!isReady)
    return (
      <AppShell>
        <div className="p-6 text-sm text-muted-foreground">{sq.chat.loading}</div>
      </AppShell>
    );
  if (!user) {
    return (
      <AppShell>
        <div className="p-6 space-y-3">
          <p className="text-sm text-muted-foreground">{sq.chat.signInToPost}</p>
          <Button asChild>
            <Link to="/auth">{sq.auth.signIn}</Link>
          </Button>
        </div>
      </AppShell>
    );
  }
  if (!canModerate) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-muted-foreground">Nuk keni akses.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl p-6">
        <h1 className="text-2xl font-bold tracking-tight">{sq.nav.admin}</h1>
        <Tabs defaultValue="reports" className="mt-6">
          <TabsList>
            <TabsTrigger value="reports">Raporte</TabsTrigger>
            <TabsTrigger value="users">Përdorues</TabsTrigger>
          </TabsList>
          <TabsContent value="reports" className="mt-4">
            <ReportsPanel />
          </TabsContent>
          <TabsContent value="users" className="mt-4">
            <UsersPanel isAdmin={isAdmin} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ReportsPanel() {
  const [reports, setReports] = useState<ModReport[]>([]);

  const load = () => {
    apiJson<ModReport[]>("/api/mod/reports?status=open")
      .then(setReports)
      .catch(() => setReports([]));
  };

  useEffect(load, []);

  async function setStatus(id: string, action: "resolve" | "dismiss") {
    try {
      await api(`/api/mod/reports/${id}/${action}`, { method: "POST" });
      load();
    } catch {
      toast.error(sq.errors.generic);
    }
  }

  return (
    <div className="space-y-2">
      {reports.length === 0 ? (
        <div className="rounded-sm border border-border p-4 text-sm text-muted-foreground">
          Nuk ka raporte të hapura.
        </div>
      ) : (
        reports.map((report) => (
          <div key={report.id} className="rounded-sm border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-widest text-primary">
                  {report.reason}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{report.message_body}</p>
                {report.note ? (
                  <p className="mt-2 text-xs text-muted-foreground">{report.note}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => setStatus(report.id, "resolve")}>
                  Zgjidh
                </Button>
                <Button size="sm" variant="outline" onClick={() => setStatus(report.id, "dismiss")}>
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
      await apiJson<void>(`/api/mod/users/${id}/roles`, {
        method: "POST",
        body: { role: "moderator", grant },
      });
      search();
    } catch {
      toast.error(sq.errors.generic);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Email ose username"
        />
        <Button onClick={search}>Kërko</Button>
      </div>
      <div className="space-y-2">
        {users.map((u) => {
          const isModerator = u.roles.includes("moderator");
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
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => post(`/api/mod/users/${u.id}/${u.is_banned ? "unban" : "ban"}`)}
                >
                  {u.is_banned ? "Zhblloko" : "Blloko"}
                </Button>
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant="outline"
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
