import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sq } from "@/i18n/sq";
import { apiNoContent } from "@/lib/api-client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Rivendos fjalëkalimin — Sheshi" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const email = params.get("email");
    if (!token || !email) {
      toast.error(sq.errors.generic);
      return;
    }

    setBusy(true);
    try {
      await apiNoContent("/api/auth/reset-password", {
        method: "POST",
        body: { email, token, password },
      });
      toast.success("Fjalëkalimi u rivendos.");
      navigate({ to: "/auth" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : sq.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">{sq.auth.resetTitle}</h1>
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
        <Button type="submit" disabled={busy} className="w-full">
          Ruaj
        </Button>
      </form>
    </div>
  );
}
