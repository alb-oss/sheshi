export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export type MessageRow = {
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
  score?: number;
  reply_count?: number;
  my_vote?: number; // -1, 0, 1
};

export type ReplyNode = { message: MessageRow; replies: ReplyNode[]; depth: number };
export type ThreadData = { root: MessageRow; replies: ReplyNode[] };
export type Room = { id: string; slug: string; name: string; description: string | null };
export type CursorPage<T> = { items: T[]; next_cursor: string | null };
export type ApiUser = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  karma?: number;
};
