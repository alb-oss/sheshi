/**
 * api.ts — request building, auth-header injection, 401 refresh-retry, and error mapping.
 * No mocking library: we install a hand-rolled fake `fetch` that records every call and returns
 * canned Responses, then assert on the captured URLs / methods / headers / bodies.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ApiError,
  API_BASE,
  clearTokens,
  listMessages,
  listUserMessages,
  login,
  loadTokens,
  resolveImageUrl,
  setVote,
  threadUrl,
  WEB_BASE,
} from "../api";

type Call = { url: string; init: RequestInit };

// Minimal Response-shaped object — only the bits api.ts touches (ok/status/json).
function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// A fake fetch that replays a queued sequence of responses and records the calls.
function installFetch(responses: Response[]): { calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  (globalThis as { fetch: unknown }).fetch = ((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return Promise.resolve(r);
  }) as typeof fetch;
  return { calls };
}

function authHeader(init: RequestInit): string | null {
  return new Headers(init.headers).get("Authorization");
}

beforeEach(async () => {
  await AsyncStorage.clear();
  // loadTokens() caches in-module; clearTokens resets that cache too.
  await clearTokens();
  jest.restoreAllMocks();
});

describe("URL builders (pure)", () => {
  it("threadUrl points at the public web base, not the API host", () => {
    expect(threadUrl("abc")).toBe(`${WEB_BASE.replace(/\/$/, "")}/tema/abc`);
  });

  it("resolveImageUrl leaves absolute URLs untouched", () => {
    expect(resolveImageUrl("https://cdn.example/x.jpg")).toBe("https://cdn.example/x.jpg");
    expect(resolveImageUrl("http://cdn.example/x.jpg")).toBe("http://cdn.example/x.jpg");
  });

  it("resolveImageUrl prefixes root-relative upload paths with the API base", () => {
    expect(resolveImageUrl("/uploads/x.jpg")).toBe(`${API_BASE}/uploads/x.jpg`);
  });

  it("resolveImageUrl inserts a slash for path-relative URLs", () => {
    expect(resolveImageUrl("uploads/x.jpg")).toBe(`${API_BASE}/uploads/x.jpg`);
  });
});

describe("login", () => {
  it("POSTs credentials as JSON and persists the returned tokens", async () => {
    const { calls } = installFetch([
      res(200, {
        access_token: "AT",
        refresh_token: "RT",
        user: { id: "u1", email: "a@b.c", username: "al", display_name: null, avatar_url: null, roles: ["user"] },
      }),
    ]);

    const user = await login("a@b.c", "pw");

    expect(user.id).toBe("u1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API_BASE}/api/auth/login`);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "a@b.c", password: "pw" });

    // Tokens were persisted, so a later request would attach them.
    expect(await loadTokens()).toEqual({ accessToken: "AT", refreshToken: "RT" });
  });

  it("throws ApiError with the status when login fails", async () => {
    installFetch([res(401, { error: "bad creds" })]);
    await expect(login("a@b.c", "wrong")).rejects.toBeInstanceOf(ApiError);
    await expect(login("a@b.c", "wrong")).rejects.toMatchObject({ status: 401 });
  });
});

describe("authenticated requests", () => {
  it("attaches the bearer token and builds the messages query string", async () => {
    await AsyncStorage.setItem("sheshi:tokens", JSON.stringify({ accessToken: "AT", refreshToken: "RT" }));
    const { calls } = installFetch([res(200, { items: [], next_cursor: null })]);

    await listMessages("room1", "cur123");

    expect(calls[0].url).toBe(`${API_BASE}/api/rooms/room1/messages?limit=30&cursor=cur123`);
    expect(authHeader(calls[0].init)).toBe("Bearer AT");
  });

  it("omits the cursor param when none is given", async () => {
    await AsyncStorage.setItem("sheshi:tokens", JSON.stringify({ accessToken: "AT", refreshToken: "RT" }));
    const { calls } = installFetch([res(200, { items: [], next_cursor: null })]);

    await listMessages("room1");

    expect(calls[0].url).toBe(`${API_BASE}/api/rooms/room1/messages?limit=30`);
  });

  it("builds the user-messages query with the post/comment type", async () => {
    await AsyncStorage.setItem("sheshi:tokens", JSON.stringify({ accessToken: "AT", refreshToken: "RT" }));
    const { calls } = installFetch([res(200, { items: [], next_cursor: null })]);

    await listUserMessages("u1", "comments");

    expect(calls[0].url).toBe(`${API_BASE}/api/users/u1/messages?type=comments&limit=30`);
  });

  it("sends the vote value as JSON on a PUT", async () => {
    await AsyncStorage.setItem("sheshi:tokens", JSON.stringify({ accessToken: "AT", refreshToken: "RT" }));
    const { calls } = installFetch([res(204, {})]);

    await setVote("m1", -1);

    expect(calls[0].url).toBe(`${API_BASE}/api/messages/m1/vote`);
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ value: -1 });
  });
});

describe("401 refresh-and-retry", () => {
  it("refreshes once on 401 and replays the request with the new token", async () => {
    await AsyncStorage.setItem("sheshi:tokens", JSON.stringify({ accessToken: "OLD", refreshToken: "RT" }));
    const { calls } = installFetch([
      res(401, { error: "expired" }), // original request
      res(200, { access_token: "NEW", refresh_token: "RT2" }), // refresh
      res(200, { items: [], next_cursor: null }), // replay
    ]);

    await listMessages("room1");

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe(`${API_BASE}/api/rooms/room1/messages?limit=30`);
    expect(authHeader(calls[0].init)).toBe("Bearer OLD");
    expect(calls[1].url).toBe(`${API_BASE}/api/auth/refresh`);
    // Replay carries the refreshed token and does NOT loop again (retry disabled).
    expect(authHeader(calls[2].init)).toBe("Bearer NEW");
  });

  it("throws ApiError(401) when the refresh itself fails (no infinite loop)", async () => {
    await AsyncStorage.setItem("sheshi:tokens", JSON.stringify({ accessToken: "OLD", refreshToken: "RT" }));
    const { calls } = installFetch([
      res(401, { error: "expired" }), // original
      res(401, { error: "refresh rejected" }), // refresh fails -> refresh() returns null
    ]);

    await expect(listMessages("room1")).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(2);
  });

  it("does not attempt a refresh when there is no token at all", async () => {
    const { calls } = installFetch([res(403, { error: "forbidden" })]);
    await expect(listMessages("room1")).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(1);
  });
});

describe("ApiError", () => {
  it("carries the status and payload", () => {
    const e = new ApiError(500, { detail: "boom" });
    expect(e.status).toBe(500);
    expect(e.payload).toEqual({ detail: "boom" });
    expect(e.message).toBe("API_500");
    expect(e).toBeInstanceOf(Error);
  });
});
