import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { setAuthTokens } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) {
      navigate({ to: "/auth" });
      return;
    }
    setAuthTokens({ accessToken, refreshToken }).finally(() => {
      navigate({ to: "/dhoma/$slug", params: { slug: "sheshi" } });
    });
  }, [navigate]);

  return null;
}
