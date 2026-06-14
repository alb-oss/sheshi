import { useEffect, useState } from "react";
import { loadTokens, me, subscribeAuth } from "./api";
import type { ApiUser } from "./types";

export function useAuth() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const tokens = await loadTokens();
      if (!tokens) {
        if (alive) {
          setUser(null);
          setReady(true);
        }
        return;
      }
      try {
        const u = await me();
        if (alive) {
          setUser(u);
          setReady(true);
        }
      } catch {
        if (alive) {
          setUser(null);
          setReady(true);
        }
      }
    };
    refresh();
    const unsub = subscribeAuth(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return { user, ready };
}
