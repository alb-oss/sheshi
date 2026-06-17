import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// use-auth is a module-singleton auth store (useSyncExternalStore) — the single source of truth for
// the signed-in user across the app (10+ importers). It loads /api/me on first use; the api-client
// transparently mints a fresh access token from the HttpOnly refresh cookie on a 401, so a valid
// cookie silently restores the session and no cookie means logged out. These tests drive that state
// machine with a header-aware fake fetch and reset the module between tests so the singleton is fresh.

const USER = {
  id: "u1",
  email: "a@b.c",
  username: "u",
  display_name: "U",
  avatar_url: null,
  roles: ["user"],
  is_banned: false,
  karma: 0,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// /api/me returns the user only when a bearer token is attached (i.e. after setAuthSession); without
// one it 401s and the (cookieless) refresh also fails — exactly the logged-out path. Everything else
// (logout, refresh) 4xxs so the best-effort flows still resolve.
function installAuthFetch() {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const authz = new Headers(init?.headers).get("authorization");
    if (url.includes("/api/me")) return authz ? json(USER) : json({ error: "UNAUTH" }, 401);
    if (url.includes("/api/auth/logout")) return new Response(null, { status: 204 });
    return new Response(null, { status: 401 }); // refresh etc. — no cookie in tests
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Fresh module graph per test so use-auth's private `state`/`initialized` singleton resets.
async function loadAuth() {
  vi.resetModules();
  return import("@/hooks/use-auth");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("use-auth state machine", () => {
  it("resolves to (user: null, isReady: true) when there is no session", async () => {
    installAuthFetch();
    const { useAuth } = await loadAuth();
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.user).toBeNull();
  });

  it("setAuthSession stores the token and loads the user from /api/me", async () => {
    installAuthFetch();
    const auth = await loadAuth();
    const { result } = renderHook(() => auth.useAuth());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.user).toBeNull(); // no token yet → anonymous

    await act(async () => {
      await auth.setAuthSession("jwt-1");
    });
    // With the token attached, /api/me now returns the user.
    await waitFor(() => expect(result.current.user?.id).toBe("u1"));
  });

  it("signOutLocal clears the user (best-effort, even if the server call fails)", async () => {
    installAuthFetch();
    const auth = await loadAuth();
    const { result } = renderHook(() => auth.useAuth());
    // Let the initial (tokenless) load settle first so it can't race past the authed load below.
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await act(async () => {
      await auth.setAuthSession("jwt-1");
    });
    await waitFor(() => expect(result.current.user?.id).toBe("u1"));

    await act(async () => {
      await auth.signOutLocal();
    });
    await waitFor(() => expect(result.current.user).toBeNull());
    expect(result.current.isReady).toBe(true);
  });

  it("a failed /api/me clears the in-memory token and ends ready-but-anonymous", async () => {
    // Token set, but the server rejects it (simulate a revoked/expired session): /api/me 401s for ANY
    // request here, so loadUser must fall back to logged-out rather than hang.
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/me")) return json({ error: "UNAUTH" }, 401);
      return new Response(null, { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const auth = await loadAuth();
    const { result } = renderHook(() => auth.useAuth());
    await act(async () => {
      await auth.setAuthSession("jwt-stale");
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.user).toBeNull();
  });
});
