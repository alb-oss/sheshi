import type { Message, ReplyNode, Thread, User } from "./types";

export type Route =
  | { name: "home" }
  | { name: "room"; slug: string }
  | { name: "thread"; id: string }
  | { name: "authCallback" }
  | { name: "confirmEmail" }
  | { name: "auth" }
  | { name: "profile" }
  | { name: "moderation" };

export type Theme = "light" | "dark";
export type AuthState = { token: string; refreshToken: string; user: User } | null;
export type HomeSort = "hot" | "new" | "top" | "replied";
export type RoomRailMode = "active" | "all";
export type PresenceUpdate = { roomId?: string; room_id?: string; count: number };
export type LoadStatus = "idle" | "loading" | "ready" | "error";
export type LoadState<T> = {
  status: LoadStatus;
  data: T;
  error?: string;
  notFound?: boolean;
};

export const authKey = "sheshi.auth";
export const themeKey = "sheshi.theme";
export const savedKey = "sheshi.saved_messages";
export const authReturnKey = "sheshi.auth_return";

export function parseRoute(): Route {
  const path = window.location.pathname;
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "dhoma" && parts[1]) return { name: "room", slug: decodeURIComponent(parts[1]) };
  if (parts[0] === "tema" && parts[1]) return { name: "thread", id: parts[1] };
  if (parts[0] === "auth" && parts[1] === "callback") return { name: "authCallback" };
  if (parts[0] === "confirm-email") return { name: "confirmEmail" };
  if (parts[0] === "auth") return { name: "auth" };
  if (parts[0] === "profili") return { name: "profile" };
  if (parts[0] === "moderim") return { name: "moderation" };
  return { name: "home" };
}

export function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function loadAuth(): AuthState {
  try {
    return JSON.parse(localStorage.getItem(authKey) || "null") as AuthState;
  } catch {
    return null;
  }
}

export function saveAuth(auth: AuthState) {
  if (auth) localStorage.setItem(authKey, JSON.stringify(auth));
  else localStorage.removeItem(authKey);
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await withTimeout(navigator.clipboard.writeText(value), 800);
      return true;
    } catch {
      // Fall through to the legacy selection copy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("COPY_TIMEOUT")), timeoutMs);
      })
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function loadSavedIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(savedKey) || "[]");
    return new Set<string>(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function displayName(author?: Message["author"] | null) {
  if (!author) return "@anon";
  return `@${author.username || author.display_name || "anon"}`;
}

export function authorInitial(author?: Message["author"] | null) {
  return (author?.username || author?.display_name || "A").slice(0, 1).toUpperCase();
}

export function authorAccent(author?: Message["author"] | null) {
  const value = author?.id || author?.username || author?.display_name || "anon";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
}

export function timeAgo(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "tani";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function patchThread(thread: Thread, next: Message): Thread {
  const patchNode = (node: ReplyNode): ReplyNode => ({
    ...node,
    message: node.message.id === next.id ? next : node.message,
    replies: node.replies.map(patchNode)
  });

  return {
    root: thread.root.id === next.id ? next : thread.root,
    replies: thread.replies.map(patchNode)
  };
}

export function findReplyNode(nodes: ReplyNode[], id: string): ReplyNode | null {
  for (const node of nodes) {
    if (node.message.id === id) return node;
    const child = findReplyNode(node.replies, id);
    if (child) return child;
  }

  return null;
}

export function sortHomeThreads(messages: Message[], sort: HomeSort) {
  const sorted = [...messages];
  if (sort === "new") {
    return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
  if (sort === "top") {
    return sorted.sort((a, b) => (
      b.upvotes - a.upvotes
      || b.reply_count - a.reply_count
      || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ));
  }
  if (sort === "replied") {
    return sorted.sort((a, b) => (
      b.reply_count - a.reply_count
      || b.upvotes - a.upvotes
      || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ));
  }

  return sorted.sort((a, b) => (
    hotScore(b) - hotScore(a)
    || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ));
}

function hotScore(message: Message) {
  const now = Date.now();
  const ageHours = Math.max((now - new Date(message.created_at).getTime()) / 36e5, 0.25);
  return message.reply_count * 30
    + message.upvotes * 12
    + 42 / Math.pow(ageHours + 1, 0.95)
    + 14 / Math.pow(ageHours + 1, 0.45);
}
