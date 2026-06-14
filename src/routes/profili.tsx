import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, ShieldCheck, Star } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sq } from "@/i18n/sq";
import { apiJson, apiNoContent } from "@/lib/api-client";
import { getStoredTokens } from "@/lib/token-store";
import { signOutLocal, useAuth, type ApiUser } from "@/hooks/use-auth";
import { canAdmin, canModerate } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/profili")({
  head: () => ({ meta: [{ title: "Profili — Sheshi" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const { user, isReady } = useAuth();
  const loading = !isReady;
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.display_name ?? "");
  }, [user?.display_name]);

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      const updated = await apiJson<ApiUser>("/api/me", {
        method: "PATCH",
        body: { display_name: displayName.slice(0, 60) },
      });
      setDisplayName(updated.display_name ?? "");
      toast.success("U ruajt");
    } catch {
      toast.error(sq.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    const refreshToken = getStoredTokens()?.refreshToken;
    try {
      if (refreshToken)
        await apiNoContent("/api/auth/logout", { method: "POST", body: { refresh_token: refreshToken } });
    } catch {
      // Local sign-out should still proceed if the server session is already gone.
    }
    signOutLocal();
    navigate({ to: "/dhoma/$slug", params: { slug: "sheshi" } });
  }

  const name = user?.display_name || user?.username || "anonim";
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const dirty = !!user && displayName.trim() !== (user.display_name ?? "");

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
        <h1 className="font-display text-2xl font-bold tracking-tight">{sq.nav.profile}</h1>

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground">{sq.chat.loading}</p>
        ) : !user ? (
          <div className="mt-6 rounded-2xl border border-border bg-card/40 p-6">
            <p className="text-sm text-muted-foreground">{sq.chat.signInToPost}</p>
            <Button asChild className="mt-4 rounded-full">
              <Link to="/auth">{sq.auth.signIn}</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {/* Identity card */}
            <div className="flex items-center gap-4 rounded-2xl border border-border bg-card/50 p-5">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xl font-bold text-foreground/80">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials || "??"
                )}
              </span>
              <div className="min-w-0">
                <div className="truncate text-lg font-bold">{name}</div>
                <div className="truncate text-sm text-muted-foreground">@{user.username || "anonim"}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {canAdmin(user) ? (
                    <RoleBadge icon={<ShieldCheck className="h-3 w-3" />} label="Admin" />
                  ) : canModerate(user) ? (
                    <RoleBadge icon={<ShieldCheck className="h-3 w-3" />} label="Moderator" />
                  ) : (
                    <RoleBadge icon={<Star className="h-3 w-3" />} label="Qytetar" muted />
                  )}
                  {user.is_banned ? <RoleBadge label="I bllokuar" danger /> : null}
                </div>
              </div>
            </div>

            {/* Account form */}
            <div className="space-y-4 rounded-2xl border border-border bg-card/30 p-5">
              <div>
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">Email</Label>
                <div className="mt-1 text-sm">{user.email ?? "—"}</div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dn" className="text-xs uppercase tracking-widest text-muted-foreground">
                  Emri për shfaqje
                </Label>
                <Input
                  id="dn"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={60}
                  className="rounded-xl"
                  placeholder={user.username ?? "Emri yt"}
                />
                <p className="text-[11px] text-muted-foreground">Kështu shfaqesh në çdo mesazh.</p>
              </div>
              <Button onClick={save} disabled={saving || !dirty} className="rounded-full">
                {saving ? "Po ruhet…" : "Ruaj"}
              </Button>
            </div>

            {(canModerate(user)) && (
              <Link
                to="/moderim"
                className="flex items-center justify-between rounded-2xl border border-border bg-card/30 p-4 text-sm font-semibold transition-colors hover:border-primary/40 hover:text-primary"
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> Paneli i moderimit
                </span>
                <span aria-hidden>→</span>
              </Link>
            )}

            <button
              type="button"
              onClick={signOut}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border p-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <LogOut className="h-4 w-4" /> {sq.auth.signOut}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function RoleBadge({
  icon,
  label,
  muted,
  danger,
}: {
  icon?: ReactNode;
  label: string;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
        danger
          ? "bg-primary/15 text-primary"
          : muted
            ? "bg-secondary text-foreground/60"
            : "bg-primary/15 text-primary",
      )}
    >
      {icon}
      {label}
    </span>
  );
}
