export type User = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  is_banned: boolean;
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  user: User;
};

export type Room = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  thread_count: number;
  latest_activity_at: string | null;
};

export type Author = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export type Message = {
  id: string;
  room_id: string;
  author_id: string;
  parent_id: string | null;
  root_message_id: string;
  depth: number;
  body: string;
  image_url: string | null;
  deleted_at: string | null;
  created_at: string;
  author: Author | null;
  upvotes: number;
  reply_count: number;
  voted: boolean;
};

export type ReplyNode = {
  message: Message;
  replies: ReplyNode[];
  depth: number;
};

export type Thread = {
  root: Message;
  replies: ReplyNode[];
};

export type CursorPage<T> = {
  items: T[];
  next_cursor: string | null;
};

export type ApiErrorPayload = {
  error?: string;
  errors?: string[];
};

export type ModReport = {
  id: string;
  message_id: string;
  reporter_id: string;
  reason: string;
  note: string | null;
  status: "open" | "resolved" | "dismissed";
  message_body: string;
  message_author_id: string;
};

export type ModUser = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  is_banned: boolean;
  roles: string[];
};

export type ModAnalytics = {
  totals: {
    rooms: number;
    users: number;
    threads: number;
    replies: number;
    messages: number;
    votes: number;
    reports: number;
  };
  last24_hours: {
    users: number;
    threads: number;
    replies: number;
    messages: number;
    votes: number;
    reports: number;
  };
  reports: {
    open: number;
    resolved: number;
    dismissed: number;
  };
  users: {
    banned: number;
    moderators: number;
    admins: number;
  };
  active_users: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  growth: {
    users: { current: number; previous: number };
    messages: { current: number; previous: number };
    votes: { current: number; previous: number };
  };
  engagement: {
    answered_threads_pct: number;
    avg_replies_per_thread: number;
  };
  moderation_health: {
    avg_resolution_hours: number | null;
    open_backlog_avg_age_hours: number | null;
    reports_per_thousand_messages: number;
    deletion_rate_pct: number;
  };
  top_authors: Array<{
    id: string;
    author: string;
    messages: number;
  }>;
  trend: Array<{
    date: string;
    users: number;
    messages: number;
    votes: number;
    reports: number;
  }>;
  top_rooms: Array<{
    id: string;
    name: string;
    slug: string;
    threads: number;
    replies: number;
    votes: number;
    reports: number;
    latest_activity_at: string | null;
  }>;
  top_posts: Array<{
    id: string;
    body: string;
    room_name: string;
    author: string;
    depth: number;
    upvotes: number;
    replies: number;
    created_at: string;
  }>;
};
