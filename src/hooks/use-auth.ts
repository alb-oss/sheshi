import { useEffect, useSyncExternalStore } from "react";
import { apiJson } from "@/lib/api-client";
import {
  clearStoredTokens,
  getStoredTokens,
  setStoredTokens,
  subscribeTokenStore,
  type StoredTokens,
} from "@/lib/token-store";

export type ApiUser = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  is_banned: boolean;
};

type AuthState = {
  session: StoredTokens | null;
  user: ApiUser | null;
  isReady: boolean;
};

let state: AuthState = { session: null, user: null, isReady: false };
const serverState: AuthState = { session: null, user: null, isReady: false };
const listeners = new Set<() => void>();
let initialized = false;
let loadingUser: Promise<void> | null = null;

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

async function loadUserFromTokens() {
  const tokens = getStoredTokens();
  if (!tokens) {
    setState({ session: null, user: null, isReady: true });
    return;
  }

  setState({ session: tokens });
  try {
    const user = await apiJson<ApiUser>("/api/me");
    setState({ session: getStoredTokens(), user, isReady: true });
  } catch {
    clearStoredTokens();
    setState({ session: null, user: null, isReady: true });
  }
}

function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  loadingUser = loadUserFromTokens();
  subscribeTokenStore(() => {
    loadingUser = loadUserFromTokens();
  });
}

function subscribe(listener: () => void) {
  init();
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
    init();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function getAuthSnapshot(): AuthState {
  init();
  return state;
}

export async function setAuthTokens(tokens: StoredTokens) {
  setStoredTokens(tokens);
  await loadingUser;
}

export function signOutLocal() {
  clearStoredTokens();
}
