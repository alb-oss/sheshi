import { clearStoredTokens, getStoredTokens, setStoredTokens } from "@/lib/token-store";

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
  const tokens = getStoredTokens();
  if (tokens?.accessToken) headers.set("Authorization", `Bearer ${tokens.accessToken}`);

  const response = await fetch(getApiBaseUrl() + path, {
    ...options,
    headers,
  });

  if (response.status === 401 && retryOnUnauthorized && tokens?.refreshToken) {
    const refreshed = await refreshTokens(tokens.refreshToken);
    if (refreshed) {
      const retryHeaders = new Headers(options.headers);
      retryHeaders.set("Authorization", `Bearer ${refreshed.accessToken}`);
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
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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

async function refreshTokens(refreshToken: string) {
  const response = await fetch(getApiBaseUrl() + "/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    clearStoredTokens();
    return null;
  }

  const body = (await response.json()) as { access_token: string; refresh_token: string };
  const tokens = { accessToken: body.access_token, refreshToken: body.refresh_token };
  setStoredTokens(tokens);
  return tokens;
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
