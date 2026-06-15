export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
};

const STORAGE_KEY = "sheshi:tokens";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getStoredTokens(): StoredTokens | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch {
    return null;
  }
}

export function setStoredTokens(tokens: StoredTokens) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  emit();
}

export function clearStoredTokens() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  emit();
}

export function subscribeTokenStore(listener: () => void) {
  listeners.add(listener);
  // Return a void-returning unsubscribe — Set.delete yields a boolean, which is not a valid
  // React effect cleanup (Destructor must return void).
  return () => {
    listeners.delete(listener);
  };
}
