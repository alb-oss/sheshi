import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sq } from "@/i18n/sq";
import { apiJson, apiNoContent, getApiBaseUrl } from "@/lib/api-client";
import { setAuthTokens } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Hyr — Sheshi" }] }),
  component: AuthPage,
});

type AuthResponse = {
  access_token: string;
  refresh_token: string;
};

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiJson<string[]>("/api/auth/providers")
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const endpoint = mode === "signup" ? "/api/auth/register" : "/api/auth/login";
      const result = await apiJson<AuthResponse>(endpoint, {
        method: "POST",
        body: { email, password, display_name: email.split("@")[0] },
      });
      await setAuthTokens({ accessToken: result.access_token, refreshToken: result.refresh_token });
      navigate({ to: "/dhoma/$slug", params: { slug: "sheshi" } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : sq.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  function handleProvider(provider: string) {
    window.location.href = `${getApiBaseUrl()}/api/auth/external/${provider}`;
  }

  async function forgot() {
    if (!email) {
      toast.error("Shkruani email-in tuaj fillimisht.");
      return;
    }
    try {
      await apiNoContent("/api/auth/forgot-password", { method: "POST", body: { email } });
      toast.success("Link rivendosjeje u dërgua në email.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : sq.errors.generic);
    }
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

        {providers.includes("google") && (
          <Button
            onClick={() => handleProvider("google")}
            disabled={busy}
            variant="outline"
            className="w-full h-11"
          >
            {sq.auth.google}
          </Button>
        )}

        {providers.length > 0 && (
          <div className="flex items-center gap-3 my-5 text-xs text-muted-foreground">
            <div className="flex-1 h-px bg-border" /> {sq.auth.or}{" "}
            <div className="flex-1 h-px bg-border" />
          </div>
        )}

        <form onSubmit={handleEmail} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">{sq.auth.email}</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">{sq.auth.password}</Label>
            <Input
              id="pw"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full h-11">
            {mode === "signin" ? sq.auth.signIn : sq.auth.signUp}
          </Button>
        </form>

        <div className="mt-4 flex flex-col gap-2 text-sm sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="inline-flex min-h-10 items-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? sq.auth.newAccount : sq.auth.haveAccount}
          </button>
          {mode === "signin" && (
            <button
              type="button"
              onClick={forgot}
              className="inline-flex min-h-10 items-center rounded-sm text-muted-foreground hover:text-foreground sm:justify-end"
            >
              {sq.auth.forgot}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
