import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { setAuthSession } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    // Scrub the fragment immediately so the token doesn't linger in history / the address bar. The
    // refresh token now rides the HttpOnly cookie the server set, so we only need the access token.
    window.history.replaceState(null, "", window.location.pathname);
    if (!accessToken) {
      navigate({ to: "/auth" });
      return;
    }
    setAuthSession(accessToken)
      .then(() => navigate({ to: "/dhoma/$slug", params: { slug: "sheshi" } }))
      .catch(() => navigate({ to: "/auth" }));
  }, [navigate]);

  return null;
}
