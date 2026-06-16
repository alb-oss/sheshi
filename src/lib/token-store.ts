// The access token lives ONLY in memory (this module variable) — never in localStorage or
// sessionStorage — so an XSS can't lift a durable credential. The long-lived refresh token lives in an
// HttpOnly cookie the API sets (`sheshi_rt`); JS never sees it. A hard refresh clears this memory, and
// the session is restored by a silent cookie-based refresh on the first authenticated call (see
// api-client's 401 handling and use-auth's boot load).

let accessToken: string | null = null;
const listeners = new Set<() => void>();

const LEGACY_KEY = "sheshi:tokens";

// One-time migration: drop any access/refresh token persisted by the old localStorage scheme so a
// previously-stored 30-day refresh token can't linger in a JS-readable store.
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // localStorage unavailable (private mode / disabled) — nothing to clean up.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  emit();
}

export function clearAccessToken() {
  accessToken = null;
  emit();
}

export function subscribeTokenStore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
