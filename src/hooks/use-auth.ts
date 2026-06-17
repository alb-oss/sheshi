import { useEffect, useSyncExternalStore } from "react";
import { apiJson, apiNoContent } from "@/lib/api-client";
import { clearAccessToken, setAccessToken } from "@/lib/token-store";
import { queryPersister } from "@/lib/query-persist";

export type ApiUser = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  is_banned: boolean;
  karma: number;
};

type AuthState = {
  user: ApiUser | null;
  isReady: boolean;
};

let state: AuthState = { user: null, isReady: false };
const serverState: AuthState = { user: null, isReady: false };
const listeners = new Set<() => void>();
let initialized = false;
let loadingUser: Promise<void> | null = null;

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

// Load the current user. With no in-memory access token (e.g. right after a hard refresh) /api/me
// 401s, and the api-client transparently mints a fresh access token from the HttpOnly refresh cookie
// and retries — so a valid cookie silently restores the session, and no cookie means logged out.
async function loadUser() {
  try {
    const user = await apiJson<ApiUser>("/api/me");
    setState({ user, isReady: true });
  } catch {
    clearAccessToken();
    setState({ user: null, isReady: true });
  }
}

function ensureAuthInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  loadingUser = loadUser();
}

function subscribe(listener: () => void) {
  ensureAuthInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AuthState {
  return state;
}

function getServerSnapshot(): AuthState {
  return serverState;
}

export function useAuth(): AuthState {
  useEffect(() => {
    ensureAuthInitialized();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Establish a session after login / register / OAuth: stash the access token in memory (the HttpOnly
// refresh cookie is already set by the server's response) and load the user.
export async function setAuthSession(accessToken: string) {
  setAccessToken(accessToken);
  await (loadingUser = loadUser());
}

// Sign out: ask the server to revoke the session and clear the HttpOnly cookie, then drop in-memory
// auth state and the persisted query cache. Best-effort — clear locally even if the server call fails.
export async function signOutLocal() {
  try {
    // Empty JSON body so the cookie-only logout isn't rejected with 415 (the endpoint binds a body
    // model); the token is read from the HttpOnly cookie.
    await apiNoContent("/api/auth/logout", { method: "POST", body: {} });
  } catch {
    // The server session may already be gone; sign out locally regardless.
  }
  clearAccessToken();
  setState({ user: null, isReady: true });
  await queryPersister.removeClient();
}
