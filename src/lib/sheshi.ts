import { supabase } from "@/integrations/supabase/client";

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
  const { data, error } = await supabase
    .from("rooms")
    .select("id, slug, name, description")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getRoomBySlug(slug: string): Promise<Room | null> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, slug, name, description")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function attachMeta(rows: MessageRow[], userId: string | null): Promise<MessageRow[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));

  const [{ data: stats }, { data: profiles }, { data: myVotes }] = await Promise.all([
    supabase.from("message_stats").select("message_id, upvotes, reply_count").in("message_id", ids),
    supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", authorIds),
    userId
      ? supabase.from("votes").select("message_id").eq("user_id", userId).in("message_id", ids)
      : Promise.resolve({ data: [] as { message_id: string }[] }),
  ]);

  const statMap = new Map((stats ?? []).map((s) => [s.message_id, s]));
  const profMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const voteSet = new Set((myVotes ?? []).map((v) => v.message_id));

  return rows.map((r) => ({
    ...r,
    upvotes: statMap.get(r.id)?.upvotes ?? 0,
    reply_count: statMap.get(r.id)?.reply_count ?? 0,
    author: profMap.get(r.author_id) ?? null,
    voted: voteSet.has(r.id),
  }));
}

export async function listMessages(roomId: string, userId: string | null): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, room_id, author_id, parent_id, body, image_url, deleted_at, created_at")
    .eq("room_id", roomId)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw error;
  return attachMeta(data ?? [], userId);
}

export async function getMessage(id: string, userId: string | null): Promise<MessageRow | null> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, room_id, author_id, parent_id, body, image_url, deleted_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [enriched] = await attachMeta([data], userId);
  return enriched;
}

export async function listReplies(parentId: string, userId: string | null): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, room_id, author_id, parent_id, body, image_url, deleted_at, created_at")
    .eq("parent_id", parentId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return attachMeta(data ?? [], userId);
}

export async function postMessage(input: {
  room_id: string;
  body: string;
  parent_id?: string | null;
}) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("UNAUTH");
  const body = input.body.trim();
  if (!body) throw new Error("EMPTY");
  if (body.length > 2000) throw new Error("TOO_LONG");
  const { error } = await supabase.from("messages").insert({
    room_id: input.room_id,
    author_id: userData.user.id,
    parent_id: input.parent_id ?? null,
    body,
  });
  if (error) throw error;
}

export async function toggleVote(messageId: string, currentlyVoted: boolean) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("UNAUTH");
  if (currentlyVoted) {
    const { error } = await supabase
      .from("votes")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userData.user.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("votes")
      .insert({ message_id: messageId, user_id: userData.user.id });
    if (error && !String(error.message).includes("duplicate")) throw error;
  }
}

export async function softDeleteMessage(id: string) {
  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export type ReportReason = "spam" | "hate" | "doxxing" | "violence" | "other";
export async function submitReport(input: {
  message_id: string;
  reason: ReportReason;
  note?: string;
}) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("UNAUTH");
  const { error } = await supabase.from("reports").insert({
    message_id: input.message_id,
    reporter_id: userData.user.id,
    reason: input.reason,
    note: input.note || null,
  });
  if (error) throw error;
}

// Highlights ranking: (upvotes + replies*2) / ageHours^1.3
export type HighlightMode = "hot" | "top" | "replied";

export async function listHighlights(mode: HighlightMode, userId: string | null): Promise<MessageRow[]> {
  const sinceDay = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let q = supabase
    .from("messages")
    .select("id, room_id, author_id, parent_id, body, image_url, deleted_at, created_at")
    .is("parent_id", null)
    .is("deleted_at", null);
  if (mode !== "hot") q = q.gte("created_at", sinceDay);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const enriched = await attachMeta(data ?? [], userId);
  const now = Date.now();
  const score = (m: MessageRow) => {
    const ageH = Math.max((now - new Date(m.created_at).getTime()) / 3600000, 0.5);
    return ((m.upvotes ?? 0) + (m.reply_count ?? 0) * 2) / Math.pow(ageH, 1.3);
  };
  const sorted = [...enriched];
  if (mode === "hot") sorted.sort((a, b) => score(b) - score(a));
  else if (mode === "top") sorted.sort((a, b) => (b.upvotes ?? 0) - (a.upvotes ?? 0));
  else sorted.sort((a, b) => (b.reply_count ?? 0) - (a.reply_count ?? 0));
  return sorted.slice(0, 10);
}
