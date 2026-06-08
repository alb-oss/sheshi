import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sq } from "@/i18n/sq";
import { apiJson } from "@/lib/api-client";
import { getStoredTokens } from "@/lib/token-store";
import { signOutLocal, useAuth, type ApiUser } from "@/hooks/use-auth";
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
        await apiJson<void>("/api/auth/logout", {
          method: "POST",
          body: { refresh_token: refreshToken },
        });
    } catch {
      // Local sign-out should still proceed if the server session is already gone.
    }
    signOutLocal();
    navigate({ to: "/r/$slug", params: { slug: "sheshi" } });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-2xl font-bold tracking-tight">{sq.nav.profile}</h1>
        {loading ? (
          <p className="mt-4 text-sm text-muted-foreground">{sq.chat.loading}</p>
        ) : !user ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted-foreground">{sq.chat.signInToPost}</p>
            <Button asChild>
              <Link to="/auth">{sq.auth.signIn}</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <div className="text-sm">{user.email}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dn">Emri për shfaqje</Label>
              <Input
                id="dn"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={save} disabled={saving}>
                Ruaj
              </Button>
              <Button variant="outline" onClick={signOut}>
                {sq.auth.signOut}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
