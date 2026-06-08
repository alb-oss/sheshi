import { useEffect, useSyncExternalStore } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Centralized auth store.
 *
 * Best practices applied:
 * - Restore from storage via getSession() once at module load (no race where
 *   queries fire before the persisted session is hydrated).
 * - Single onAuthStateChange subscription for the whole app — components
 *   subscribe via useSyncExternalStore so every consumer sees the same value
 *   at the same time.
 * - Callback is "fire and forget": no awaits inside the listener (prevents
 *   Supabase auth deadlocks).
 * - isReady flips true only after the initial getSession() resolves so
 *   consumers can gate queries with `enabled: isReady`.
 */

type AuthState = {
  session: Session | null;
  user: User | null;
  isReady: boolean;
};

let state: AuthState = { session: null, user: null, isReady: false };
const serverState: AuthState = { session: null, user: null, isReady: false };
const listeners = new Set<() => void>();

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

let initialized = false;
function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // 1. Restore persisted session synchronously from storage
  supabase.auth.getSession().then(({ data }) => {
    setState({
      session: data.session ?? null,
      user: data.session?.user ?? null,
      isReady: true,
    });
  });

  // 2. Subscribe to changes — fire and forget, no awaits inside
  supabase.auth.onAuthStateChange((_event, session) => {
    setState({
      session: session ?? null,
      user: session?.user ?? null,
      isReady: true,
    });
  });
}

function subscribe(cb: () => void) {
  init();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): AuthState {
  return state;
}

function getServerSnapshot(): AuthState {
  return serverState;
}

export function useAuth(): AuthState {
  // Kick off initialization on first import in a client environment too
  useEffect(() => {
    init();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Access current auth state outside React (e.g. inside async helpers). */
export function getAuthSnapshot(): AuthState {
  init();
  return state;
}
