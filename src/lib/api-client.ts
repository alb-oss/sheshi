import { clearAccessToken, getAccessToken, setAccessToken } from "@/lib/token-store";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: unknown,
  ) {
    super(message);
  }
}

export function getApiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL || "http://localhost:5080").replace(/\/$/, "");
}

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  retryOnUnauthorized?: boolean;
};

export async function api(
  path: string,
  options: RequestInit & { retryOnUnauthorized?: boolean } = {},
) {
  const retryOnUnauthorized = options.retryOnUnauthorized ?? true;
  const headers = new Headers(options.headers);
  const accessToken = getAccessToken();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(getApiBaseUrl() + path, {
    ...options,
    headers,
    // Send/receive the HttpOnly refresh cookie (sheshi_rt) — the only cookie, scoped to /api/auth.
    // Needed so login/refresh Set-Cookie is honored and the cookie is sent on refresh.
    credentials: "include",
  });

  // 401 = expired/missing access token (incl. a fresh page load before the in-memory token exists).
  // 403 = authenticated but forbidden — also happens right after a role grant when the access token
  // predates it. In both cases attempt ONE cookie-based refresh (the refresh token rides the HttpOnly
  // cookie, not the body) and retry; a genuine 403, or no valid cookie, fails on the retry (no loop).
  if ((response.status === 401 || response.status === 403) && retryOnUnauthorized) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      const retryHeaders = new Headers(options.headers);
      retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);
      return api(path, { ...options, headers: retryHeaders, retryOnUnauthorized: false });
    }
  }

  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function apiJson<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await api(path, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) throw new ApiError(204, "EMPTY_RESPONSE");
  return response.json() as Promise<T>;
}

export async function apiNoContent(path: string, options: ApiOptions = {}): Promise<void> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  await api(path, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export async function apiForm<T>(
  path: string,
  form: FormData,
  options: RequestInit = {},
): Promise<T> {
  const response = await api(path, {
    ...options,
    method: options.method ?? "POST",
    body: form,
  });
  return response.json() as Promise<T>;
}

// Mint a fresh access token from the HttpOnly refresh cookie. No token in the body — the browser
// sends `sheshi_rt` because of credentials:"include". Returns the new access token, or null (and clears
// the in-memory token) when there's no valid cookie. Coalesced so a burst of 401s triggers one refresh.
let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(getApiBaseUrl() + "/api/auth/refresh", {
        method: "POST",
        credentials: "include",
        // The refresh endpoint binds a JSON body; send an empty object so a cookie-only refresh isn't
        // rejected with 415 (the token comes from the HttpOnly cookie, not the body).
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        clearAccessToken();
        return null;
      }
      const body = (await response.json()) as { access_token: string };
      setAccessToken(body.access_token);
      return body.access_token;
    } catch {
      clearAccessToken();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function toApiError(response: Response) {
  const text = await response.text();
  if (!text) return new ApiError(response.status, response.statusText);
  try {
    const payload = JSON.parse(text) as { error?: string; errors?: string[] };
    return new ApiError(
      response.status,
      payload.error || payload.errors?.[0] || response.statusText,
      payload,
    );
  } catch {
    return new ApiError(response.status, text);
  }
}
