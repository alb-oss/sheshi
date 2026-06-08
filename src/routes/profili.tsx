import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sq } from "@/i18n/sq";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/profili")({
  head: () => ({ meta: [{ title: "Profili — Sheshi" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { setLoading(false); return; }
      setUser({ id: data.user.id, email: data.user.email ?? null });
      const { data: p } = await supabase.from("profiles").select("display_name").eq("id", data.user.id).maybeSingle();
      setDisplayName(p?.display_name ?? "");
      setLoading(false);
    });
  }, []);

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
