import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sq } from "@/i18n/sq";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Hyr — Sheshi" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
        });
        if (error) throw error;
        toast.success("Llogaria u krijua. Kontrollo email-in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/r/$slug", params: { slug: "sheshi" } });
      }
    } catch (e: any) {
      toast.error(e?.message || sq.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) { toast.error(result.error.message || sq.errors.generic); return; }
      if (result.redirected) return;
      navigate({ to: "/r/$slug", params: { slug: "sheshi" } });
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email) { toast.error("Shkruani email-in tuaj fillimisht."); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    if (error) toast.error(error.message);
    else toast.success("Link rivendosjeje u dërgua në email.");
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="inline-block h-7 w-7 rounded-sm bg-primary" />
            <span className="font-bold text-2xl tracking-tight">{sq.appName}</span>
          </Link>
          <h1 className="mt-4 text-xl font-semibold">{sq.auth.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{sq.auth.subtitle}</p>
        </div>

        <Button onClick={handleGoogle} disabled={busy} variant="outline" className="w-full h-11">
          {sq.auth.google}
        </Button>

        <div className="flex items-center gap-3 my-5 text-xs text-muted-foreground">
          <div className="flex-1 h-px bg-border" /> {sq.auth.or} <div className="flex-1 h-px bg-border" />
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">{sq.auth.email}</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">{sq.auth.password}</Label>
            <Input id="pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy} className="w-full h-11">
            {mode === "signin" ? sq.auth.signIn : sq.auth.signUp}
          </Button>
        </form>

        <div className="mt-4 flex justify-between text-sm">
          <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-muted-foreground hover:text-foreground">
            {mode === "signin" ? sq.auth.newAccount : sq.auth.haveAccount}
          </button>
          {mode === "signin" && (
            <button type="button" onClick={forgot} className="text-muted-foreground hover:text-foreground">
              {sq.auth.forgot}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
