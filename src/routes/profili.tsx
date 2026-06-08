import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sq } from "@/i18n/sq";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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
    if (!user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setDisplayName(data?.display_name ?? "");
      });
    return () => { cancelled = true; };
  }, [user]);

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ display_name: displayName.slice(0, 60) }).eq("id", user.id);
    setSaving(false);
    if (error) toast.error(sq.errors.generic);
    else toast.success("U ruajt");
  }

  async function signOut() {
    await supabase.auth.signOut();
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
            <Button asChild><Link to="/auth">{sq.auth.signIn}</Link></Button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <div className="text-sm">{user.email}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dn">Emri për shfaqje</Label>
              <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={save} disabled={saving}>Ruaj</Button>
              <Button variant="outline" onClick={signOut}>{sq.auth.signOut}</Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
