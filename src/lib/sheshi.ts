import { api, ApiError, apiForm, apiJson, apiNoContent } from "@/lib/api-client";

export type SheshiErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "UNAUTH"
  | "RATE_LIMITED"
  | "INVALID_IMAGE"
  | "INVALID_VIDEO"
  | "UPLOAD_FAILED";

export class SheshiError extends Error {
  code: SheshiErrorCode;
  status?: number;

  constructor(code: SheshiErrorCode, options: { cause?: unknown; status?: number } = {}) {
    super(code, { cause: options.cause });
    this.name = "SheshiError";
    this.code = code;
    this.status = options.status;
  }
}

function toMessageMutationError(error: unknown): SheshiError | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 401) return new SheshiError("UNAUTH", { cause: error, status: 401 });
  if (error.status === 429) return new SheshiError("RATE_LIMITED", { cause: error, status: 429 });
  const code = apiErrorCode(error);
  if (code === "TOO_LONG")
    return new SheshiError("TOO_LONG", { cause: error, status: error.status });
  if (code === "EMPTY") return new SheshiError("EMPTY", { cause: error, status: error.status });
  if (
    code === "INVALID_IMAGE" ||
    code === "UNSUPPORTED_IMAGE_TYPE" ||
    code === "IMAGE_DIMENSIONS_TOO_LARGE" ||
    code === "IMAGE_TOO_LARGE"
  )
    return new SheshiError("INVALID_IMAGE", { cause: error, status: error.status });
  if (code === "INVALID_VIDEO" || code === "UNSUPPORTED_VIDEO_TYPE" || code === "VIDEO_TOO_LARGE")
    return new SheshiError("INVALID_VIDEO", { cause: error, status: error.status });
  // The object store rejected the upload (502 UPLOAD_FAILED) — a real reason, not a silent generic 500.
  if (code === "UPLOAD_FAILED" || error.status === 502)
    return new SheshiError("UPLOAD_FAILED", { cause: error, status: error.status });
  return null;
}

function apiErrorCode(error: ApiError) {
  const payload = error.payload as { error?: string; errors?: string[] } | undefined;
  return payload?.error ?? payload?.errors?.[0];
}

export interface Room {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  // Server-guaranteed (RoomDto.ThreadCount is non-null int); only latest_activity_at is genuinely nullable.
  thread_count: number;
  latest_activity_at?: string | null;
}

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface MessageRow {
  id: string;
  room_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  image_url: string | null;
  video_url: string | null;
  deleted_at: string | null;
  created_at: string;
  author?: Profile | null;
  // Server-guaranteed non-null (MessageDto.Score/ReplyCount/MyVote use GetValueOrDefault → always an
  // int on the wire, including realtime broadcasts where my_vote is 0). Only `author` is nullable.
  score: number;
  reply_count: number;
  my_vote: number; // -1, 0, or 1
}

export interface ReplyNode {
  message: MessageRow;
  replies: ReplyNode[];
  depth: number;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

export interface ThreadData {
  root: MessageRow;
  replies: ReplyNode[];
}

export function listRooms(): Promise<Room[]> {
  return apiJson<Room[]>("/api/rooms");
}

export async function getRoomBySlug(slug: string): Promise<Room | null> {
  try {
    return await apiJson<Room>(`/api/rooms/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function createRoom(input: { name: string; description?: string | null }): Promise<Room> {
  return apiJson<Room>("/api/rooms", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description || null,
    },
  });
}

export function listMessages(
  roomId: string,
  cursor?: string | null,
  limit = 40,
): Promise<CursorPage<MessageRow>> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiJson<CursorPage<MessageRow>>(`/api/rooms/${roomId}/messages?${params.toString()}`);
}

export interface MediaItem {
  message_id: string;
  kind: "image" | "video";
  url: string;
  created_at: string;
  author: string | null;
}

// All media (images + videos) in a room, chronological — for the swipeable gallery.
export function listRoomMedia(roomId: string): Promise<MediaItem[]> {
  return apiJson<MediaItem[]>(`/api/rooms/${roomId}/media`);
}

export async function getMessage(id: string): Promise<MessageRow | null> {
  try {
    return await apiJson<MessageRow>(`/api/messages/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function listReplies(
  parentId: string,
  cursor?: string | null,
  limit = 80,
): Promise<CursorPage<MessageRow>> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiJson<CursorPage<MessageRow>>(`/api/messages/${parentId}/replies?${params.toString()}`);
}

// A user's own posts or comments, for the profile page. Newest-first, deleted excluded.
export function listUserMessages(
  userId: string,
  type: "posts" | "comments",
  cursor?: string | null,
  limit = 30,
): Promise<CursorPage<MessageRow>> {
  const params = new URLSearchParams({ type, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiJson<CursorPage<MessageRow>>(`/api/users/${userId}/messages?${params.toString()}`);
}

export async function getThread(messageId: string): Promise<ThreadData | null> {
  try {
    return await apiJson<ThreadData>(`/api/threads/${messageId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function postMessage(input: {
  room_id: string;
  body: string;
  parent_id?: string | null;
  image?: File | null;
  video?: File | null;
}): Promise<MessageRow> {
  const body = input.body.trim();
  if (!body && !input.image && !input.video) throw new SheshiError("EMPTY");
  if (body.length > 2000) throw new SheshiError("TOO_LONG");

  try {
    if (input.image || input.video) {
      const form = new FormData();
      form.set("room_id", input.room_id);
      if (input.parent_id) form.set("parent_id", input.parent_id);
      form.set("body", body);
      if (input.image) form.set("image", input.image);
      if (input.video) form.set("video", input.video);
      return await apiForm<MessageRow>("/api/messages", form);
    }

    return await apiJson<MessageRow>("/api/messages", {
      method: "POST",
      body: { room_id: input.room_id, parent_id: input.parent_id ?? null, body },
    });
  } catch (error) {
    const sheshiError = toMessageMutationError(error);
    if (sheshiError) throw sheshiError;
    throw error;
  }
}

// Reddit-style directional vote: value 1 = up, -1 = down, 0 = clear. The server upserts the
// caller's vote and returns the net score over realtime.
export async function setVote(messageId: string, value: -1 | 0 | 1) {
  try {
    await apiNoContent(`/api/messages/${messageId}/vote`, { method: "PUT", body: { value } });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      throw new SheshiError("UNAUTH", { cause: error, status: 401 });
    if (error instanceof ApiError && error.status === 429)
      throw new SheshiError("RATE_LIMITED", { cause: error, status: 429 });
    throw error;
  }
}

export function softDeleteMessage(id: string): Promise<void> {
  return apiNoContent(`/api/messages/${id}`, { method: "DELETE" });
}

// Closed-set moderation values. These MIRROR the C# domain enums (Domain/Enums.cs), which the API
// serialises as snake_case-lower tokens via the global JsonStringEnumConverter — keep them in sync.
export type ReportReason = "spam" | "hate" | "doxxing" | "violence" | "other";
export type ReportStatus = "open" | "resolved" | "dismissed";
export type ModerationSeverity = "low" | "medium" | "high" | "critical";
export type ModerationCategory = "spam" | "hate" | "doxxing" | "violence" | "harassment" | "other";
export type ModerationFlagStatus = "open" | "resolved" | "dismissed";
export async function submitReport(input: {
  message_id: string;
  reason: ReportReason;
  note?: string;
}) {
  try {
    await api(`/api/messages/${input.message_id}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: input.reason, note: input.note || null }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      throw new SheshiError("UNAUTH", { cause: error, status: 401 });
    throw error;
  }
}

export type HighlightMode = "hot" | "top" | "replied";

export function listHighlights(mode: HighlightMode): Promise<MessageRow[]> {
  return apiJson<MessageRow[]>(`/api/highlights?mode=${encodeURIComponent(mode)}`);
}
