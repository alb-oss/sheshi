import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import type { ApiUser, CursorPage, MessageRow, Room, ThreadData } from "./types";

// Point this at your running API. iOS simulator can reach the host as localhost; a physical
// device on Expo Go needs your machine's LAN IP (e.g. http://192.168.1.20:5080). Override in
// app.json -> expo.extra.apiBase.
export const API_BASE: string =
  (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase ?? "http://localhost:5080";

type Tokens = { accessToken: string; refreshToken: string };
const TOKEN_KEY = "sheshi:tokens";

let cached: Tokens | null = null;
const listeners = new Set<() => void>();

export async function loadTokens(): Promise<Tokens | null> {
  if (cached) return cached;
  const raw = await AsyncStorage.getItem(TOKEN_KEY);
  cached = raw ? (JSON.parse(raw) as Tokens) : null;
  return cached;
}

export async function setTokens(tokens: Tokens) {
  cached = tokens;
  await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  listeners.forEach((l) => l());
}

export async function clearTokens() {
  cached = null;
  await AsyncStorage.removeItem(TOKEN_KEY);
  listeners.forEach((l) => l());
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export class ApiError extends Error {
  constructor(public status: number, public payload?: unknown) {
    super(`API_${status}`);
  }
}

async function refresh(refreshToken: string): Promise<Tokens | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    const next = { accessToken: body.access_token, refreshToken: body.refresh_token };
    await setTokens(next);
    return next;
  } catch {
    return null;
  }
}

async function request(path: string, options: RequestInit & { retry?: boolean } = {}): Promise<Response> {
  const retry = options.retry ?? true;
  const tokens = await loadTokens();
  const headers = new Headers(options.headers);
  if (tokens?.accessToken) headers.set("Authorization", `Bearer ${tokens.accessToken}`);

  const res = await fetch(API_BASE + path, { ...options, headers });

  if ((res.status === 401 || res.status === 403) && retry && tokens?.refreshToken) {
    const refreshed = await refresh(tokens.refreshToken);
    if (refreshed) {
      const h = new Headers(options.headers);
      h.set("Authorization", `Bearer ${refreshed.accessToken}`);
      return request(path, { ...options, headers: h, retry: false });
    }
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
  return res;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await request(path);
  return (await res.json()) as T;
}

// ---- Endpoints ----
export async function login(email: string, password: string): Promise<ApiUser> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
  const body = (await res.json()) as { access_token: string; refresh_token: string; user: ApiUser };
  await setTokens({ accessToken: body.access_token, refreshToken: body.refresh_token });
  return body.user;
}

export async function logout() {
  const tokens = await loadTokens();
  if (tokens?.refreshToken) {
    await request("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    }).catch(() => {});
  }
  await clearTokens();
}

export const me = () => getJson<ApiUser>("/api/me");
export const listRooms = () => getJson<Room[]>("/api/rooms");
export const getRoomBySlug = async (slug: string) =>
  (await getJson<Room[]>("/api/rooms")).find((r) => r.slug === slug) ?? null;

export function listMessages(roomId: string, cursor?: string | null) {
  const q = new URLSearchParams({ limit: "30" });
  if (cursor) q.set("cursor", cursor);
  return getJson<CursorPage<MessageRow>>(`/api/rooms/${roomId}/messages?${q.toString()}`);
}

export const getThread = (id: string) => getJson<ThreadData>(`/api/threads/${id}`);

export const listHighlights = (mode: "hot" | "top" | "replied") =>
  getJson<MessageRow[]>(`/api/highlights?mode=${mode}`);

export async function setVote(messageId: string, value: -1 | 0 | 1) {
  await request(`/api/messages/${messageId}/vote`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

export type PickedImage = { uri: string; mimeType?: string | null; fileName?: string | null };
export type PickedVideo = { uri: string; mimeType?: string | null; fileName?: string | null };

// Resolve a stored upload URL (often a root-relative /uploads/... path) to an absolute URL the
// native <Image>/<VideoView> can load. Already-absolute URLs (the API returns these in dev) pass
// through unchanged.
export const resolveImageUrl = (u: string) =>
  /^https?:\/\//.test(u) ? u : `${API_BASE}${u.startsWith("/") ? "" : "/"}${u}`;
export const resolveVideoUrl = resolveImageUrl;

export async function postMessage(input: {
  room_id: string;
  body: string;
  parent_id?: string | null;
  image?: PickedImage | null;
  video?: PickedVideo | null;
}) {
  if (input.image || input.video) {
    // Multipart so the API's ReadPostMessageAsync picks up room_id/parent_id/body + the file part.
    // fetch sets the multipart boundary automatically (no Content-Type header).
    const form = new FormData();
    form.append("room_id", input.room_id);
    if (input.parent_id) form.append("parent_id", input.parent_id);
    form.append("body", input.body);
    if (input.image) {
      const type = input.image.mimeType || "image/jpeg";
      const name = input.image.fileName || `photo.${type.split("/")[1] || "jpg"}`;
      form.append("image", { uri: input.image.uri, name, type } as unknown as Blob);
    }
    if (input.video) {
      const type = input.video.mimeType || "video/mp4";
      const name = input.video.fileName || `clip.${type.split("/")[1] || "mp4"}`;
      form.append("video", { uri: input.video.uri, name, type } as unknown as Blob);
    }
    const res = await request("/api/messages", { method: "POST", body: form });
    return (await res.json()) as MessageRow;
  }
  const res = await request("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room_id: input.room_id, parent_id: input.parent_id ?? null, body: input.body }),
  });
  return (await res.json()) as MessageRow;
}
