import { api, ApiError, apiForm, apiJson } from "@/lib/api-client";

export interface Room {
  id: string;
  slug: string;
  name: string;
  description: string | null;
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
  deleted_at: string | null;
  created_at: string;
  author?: Profile | null;
  upvotes?: number;
  reply_count?: number;
  voted?: boolean;
}

export async function listRooms(): Promise<Room[]> {
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

export async function listMessages(roomId: string): Promise<MessageRow[]> {
  return apiJson<MessageRow[]>(`/api/rooms/${roomId}/messages`);
}

export async function getMessage(id: string): Promise<MessageRow | null> {
  try {
    return await apiJson<MessageRow>(`/api/messages/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function listReplies(parentId: string): Promise<MessageRow[]> {
  return apiJson<MessageRow[]>(`/api/messages/${parentId}/replies`);
}

export async function postMessage(input: {
  room_id: string;
  body: string;
  parent_id?: string | null;
  image?: File | null;
}) {
  const body = input.body.trim();
  if (!body) throw new Error("EMPTY");
  if (body.length > 2000) throw new Error("TOO_LONG");

  try {
    if (input.image) {
      const form = new FormData();
      form.set("room_id", input.room_id);
      if (input.parent_id) form.set("parent_id", input.parent_id);
      form.set("body", body);
      form.set("image", input.image);
      await apiForm<MessageRow>("/api/messages", form);
    } else {
      await apiJson<MessageRow>("/api/messages", {
        method: "POST",
        body: { room_id: input.room_id, parent_id: input.parent_id ?? null, body },
      });
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw new Error("UNAUTH");
    if (error instanceof ApiError && error.message === "TOO_LONG") throw new Error("TOO_LONG");
    if (error instanceof ApiError && error.message === "EMPTY") throw new Error("EMPTY");
    throw error;
  }
}

export async function toggleVote(messageId: string, currentlyVoted: boolean) {
  try {
    if (currentlyVoted) await api(`/api/messages/${messageId}/vote`, { method: "DELETE" });
    else await api(`/api/messages/${messageId}/vote`, { method: "PUT" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw new Error("UNAUTH");
    throw error;
  }
}

export async function softDeleteMessage(id: string) {
  await api(`/api/messages/${id}`, { method: "DELETE" });
}

export type ReportReason = "spam" | "hate" | "doxxing" | "violence" | "other";
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
    if (error instanceof ApiError && error.status === 401) throw new Error("UNAUTH");
    throw error;
  }
}

export type HighlightMode = "hot" | "top" | "replied";

export async function listHighlights(mode: HighlightMode): Promise<MessageRow[]> {
  return apiJson<MessageRow[]>(`/api/highlights?mode=${encodeURIComponent(mode)}`);
}
