import { describe, expect, it } from "vitest";
import { canAdmin, canModerate, hasRole, Roles } from "./roles";
import { roomPath, threadPath } from "./api";
import {
  authorInitial,
  displayName,
  findReplyNode,
  patchThread,
  sortHomeThreads,
  timeAgo
} from "./appSupport";
import type { Message, ReplyNode, Thread } from "./types";

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    room_id: "r1",
    author_id: "a1",
    parent_id: null,
    root_message_id: "m1",
    depth: 0,
    body: "hello",
    image_url: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    author: { id: "a1", username: "ada", display_name: "Ada", avatar_url: null },
    upvotes: 0,
    reply_count: 0,
    voted: false,
    ...overrides
  };
}

describe("roles", () => {
  const admin = { roles: [Roles.User, Roles.Admin] };
  const mod = { roles: [Roles.User, Roles.Moderator] };
  const user = { roles: [Roles.User] };

  it("hasRole checks membership", () => {
    expect(hasRole(admin, Roles.Admin)).toBe(true);
    expect(hasRole(user, Roles.Admin)).toBe(false);
    expect(hasRole(null, Roles.User)).toBe(false);
  });

  it("canModerate covers moderators and admins, not plain users", () => {
    expect(canModerate(mod)).toBe(true);
    expect(canModerate(admin)).toBe(true);
    expect(canModerate(user)).toBe(false);
  });

  it("canAdmin is admin-only", () => {
    expect(canAdmin(admin)).toBe(true);
    expect(canAdmin(mod)).toBe(false);
  });
});

describe("path helpers", () => {
  it("builds room and thread paths with encoding", () => {
    expect(roomPath("sheshi")).toBe("/dhoma/sheshi");
    expect(threadPath("abc-123")).toBe("/tema/abc-123");
  });
});

describe("display helpers", () => {
  it("displayName falls back to anon", () => {
    expect(displayName({ id: "x", username: "bob", display_name: null, avatar_url: null })).toBe("@bob");
    expect(displayName(null)).toBe("@anon");
  });

  it("authorInitial uppercases the first character", () => {
    expect(authorInitial({ id: "x", username: "ada", display_name: null, avatar_url: null })).toBe("A");
    expect(authorInitial(null)).toBe("A");
  });

  it("timeAgo renders coarse buckets", () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 5_000).toISOString())).toBe("tani");
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe("5m");
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h");
    expect(timeAgo(new Date(now - 2 * 86_400_000).toISOString())).toBe("2d");
  });
});

describe("sortHomeThreads", () => {
  const a = msg({ id: "a", upvotes: 1, reply_count: 10, created_at: new Date(Date.now() - 3_600_000).toISOString() });
  const b = msg({ id: "b", upvotes: 20, reply_count: 0, created_at: new Date(Date.now() - 7_200_000).toISOString() });
  const c = msg({ id: "c", upvotes: 0, reply_count: 0, created_at: new Date().toISOString() });

  it("'new' orders by recency", () => {
    expect(sortHomeThreads([a, b, c], "new").map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it("'top' leads with most upvotes", () => {
    expect(sortHomeThreads([a, b, c], "top")[0].id).toBe("b");
  });

  it("'replied' leads with most replies", () => {
    expect(sortHomeThreads([a, b, c], "replied")[0].id).toBe("a");
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortHomeThreads(input, "top");
    expect(input.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("thread helpers", () => {
  const thread: Thread = {
    root: msg({ id: "root" }),
    replies: [
      { message: msg({ id: "r1", parent_id: "root", depth: 1 }), depth: 1, replies: [
        { message: msg({ id: "r2", parent_id: "r1", depth: 2 }), depth: 2, replies: [] }
      ] }
    ]
  };

  it("findReplyNode locates nested nodes", () => {
    expect(findReplyNode(thread.replies, "r2")?.message.id).toBe("r2");
    expect(findReplyNode(thread.replies, "missing")).toBeNull();
  });

  it("patchThread replaces a matching node immutably", () => {
    const updated = patchThread(thread, msg({ id: "r2", parent_id: "r1", depth: 2, upvotes: 9, voted: true }));
    const node = findReplyNode(updated.replies, "r2") as ReplyNode;
    expect(node.message.upvotes).toBe(9);
    expect(node.message.voted).toBe(true);
    // original untouched
    expect(findReplyNode(thread.replies, "r2")?.message.upvotes).toBe(0);
  });

  it("patchThread replaces the root when ids match", () => {
    const updated = patchThread(thread, msg({ id: "root", upvotes: 4 }));
    expect(updated.root.upvotes).toBe(4);
  });
});
