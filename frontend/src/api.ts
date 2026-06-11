import type { AuthResponse, CursorPage, Message, ModAnalytics, ModReport, ModUser, Room, Thread, User } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5080").replace(/\/$/, "");

type RequestOptions = {
  method?: string;
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
};

let refreshSession: (() => Promise<string | null>) | null = null;

export function setRefreshSession(handler: (() => Promise<string | null>) | null) {
  refreshSession = handler;
}

function dispatch(path: string, options: RequestOptions, token?: string | null): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  return fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
  });
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  let response = await dispatch(path, options, options.token);

  // An expired access token gets one transparent refresh-and-retry.
  if (response.status === 401 && options.token && refreshSession) {
    const refreshedToken = await refreshSession();
    if (refreshedToken) response = await dispatch(path, options, refreshedToken);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; errors?: string[] } | null;
    const code = payload?.error ?? payload?.errors?.[0];
    throw new ApiError(response.status, code || `HTTP_${response.status}`, code);
  }

  return response;
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) throw new ApiError(204, "EMPTY_RESPONSE", "EMPTY_RESPONSE");
  return response.json() as Promise<T>;
}

async function requestNoContent(path: string, options: RequestOptions = {}): Promise<void> {
  await send(path, options);
}

export const apiBase = API_BASE;

type RoomRequest = { slug: string };
type CreateRoomRequest = { token: string; input: { name: string; slug?: string; description?: string } };
type MessagesRequest = { roomId: string; cursor?: string | null; token?: string | null };
type ThreadRequest = { id: string; token?: string | null };
type HighlightsRequest = { mode?: "focus" | "hot" | "fresh" | "top" | "replied"; token?: string | null };
type MessageMutationRequest = {
  token: string;
  input: { room_id: string; parent_id?: string | null; body: string };
};
type VoteRequest = { token: string; id: string };
type LoginRequest = { email: string; password: string };
type RegisterRequest = { email: string; password: string; displayName: string };
type ExternalAuthRequest = { provider: string };
type MeRequest = { token: string };
type ModReportsRequest = { token: string; status?: "open" | "resolved" | "dismissed" };
type ModReportActionRequest = { token: string; id: string };
type ModUsersRequest = { token: string; query?: string };
type ModUserActionRequest = { token: string; id: string };
type ModRoleRequest = { token: string; id: string; grant: boolean };

export const api = {
  rooms: () => requestJson<Room[]>("/api/rooms"),
  room: ({ slug }: RoomRequest) => requestJson<Room>(`/api/rooms/${encodeURIComponent(slug)}`),
  createRoom: ({ token, input }: CreateRoomRequest) =>
    requestJson<Room>("/api/rooms", { method: "POST", token, body: input }),

  messages: ({ roomId, cursor, token }: MessagesRequest) => {
    const params = new URLSearchParams({ limit: "40" });
    if (cursor) params.set("cursor", cursor);
    return requestJson<CursorPage<Message>>(`/api/rooms/${roomId}/messages?${params.toString()}`, { token });
  },
  thread: ({ id, token }: ThreadRequest) => requestJson<Thread>(`/api/threads/${id}`, { token }),
  highlights: ({ mode = "hot", token }: HighlightsRequest = {}) =>
    requestJson<Message[]>(`/api/highlights?mode=${mode}`, { token }),
  presence: () => requestJson<Record<string, number>>("/api/rooms/presence"),
  postMessage: ({ token, input }: MessageMutationRequest) =>
    requestJson<Message>("/api/messages", { method: "POST", token, body: input }),
  upvote: ({ token, id }: VoteRequest) =>
    requestNoContent(`/api/messages/${id}/vote`, { method: "PUT", token }),
  removeUpvote: ({ token, id }: VoteRequest) =>
    requestNoContent(`/api/messages/${id}/vote`, { method: "DELETE", token }),
  deleteMessage: ({ token, id }: VoteRequest) =>
    requestNoContent(`/api/messages/${id}`, { method: "DELETE", token }),

  modAnalytics: ({ token }: MeRequest) =>
    requestJson<ModAnalytics>("/api/mod/analytics", { token }),
  modReports: ({ token, status = "open" }: ModReportsRequest) =>
    requestJson<ModReport[]>(`/api/mod/reports?status=${encodeURIComponent(status)}`, { token }),
  resolveReport: ({ token, id }: ModReportActionRequest) =>
    requestNoContent(`/api/mod/reports/${id}/resolve`, { method: "POST", token }),
  dismissReport: ({ token, id }: ModReportActionRequest) =>
    requestNoContent(`/api/mod/reports/${id}/dismiss`, { method: "POST", token }),
  modUsers: ({ token, query = "" }: ModUsersRequest) =>
    requestJson<ModUser[]>(`/api/mod/users?query=${encodeURIComponent(query)}`, { token }),
  banUser: ({ token, id }: ModUserActionRequest) =>
    requestNoContent(`/api/mod/users/${id}/ban`, { method: "POST", token }),
  unbanUser: ({ token, id }: ModUserActionRequest) =>
    requestNoContent(`/api/mod/users/${id}/unban`, { method: "POST", token }),
  setModerator: ({ token, id, grant }: ModRoleRequest) =>
    requestNoContent(`/api/mod/users/${id}/roles`, { method: "POST", token, body: { role: "moderator", grant } }),

  login: ({ email, password }: LoginRequest) =>
    requestJson<AuthResponse>("/api/auth/login", { method: "POST", body: { email, password } }),
  register: ({ email, password, displayName }: RegisterRequest) =>
    requestJson<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: { email, password, display_name: displayName }
    }),
  refresh: ({ refreshToken }: { refreshToken: string }) =>
    requestJson<AuthResponse>("/api/auth/refresh", { method: "POST", body: { refresh_token: refreshToken } }),
  logout: ({ token, refreshToken }: { token: string; refreshToken: string }) =>
    requestNoContent("/api/auth/logout", { method: "POST", token, body: { refresh_token: refreshToken } }),
  confirmEmail: ({ email, token }: { email: string; token: string }) =>
    requestNoContent("/api/auth/confirm-email", { method: "POST", body: { email, token } }),
  authProviders: () => requestJson<string[]>("/api/auth/providers"),
  externalAuthUrl: ({ provider }: ExternalAuthRequest) => `${API_BASE}/api/auth/external/${encodeURIComponent(provider)}`,
  me: ({ token }: MeRequest) => requestJson<User>("/api/me", { token })
};

export function roomPath(slug: string) {
  return `/dhoma/${slug}`;
}

export function threadPath(id: string) {
  return `/tema/${id}`;
}
