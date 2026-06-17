import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, apiJson, apiNoContent, getApiBaseUrl } from "@/lib/api-client";
import { clearAccessToken, setAccessToken } from "@/lib/token-store";

// The request helpers are tested against a hand-rolled fake `fetch` (vi.fn returning canned
// Responses) — no network, no mocking library. We assert the error SHAPE the rest of the app relies
// on (ApiError.status + the extracted error code) and the 401/403 → single-refresh-then-retry
// behaviour, which is a security/correctness contract.

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  clearAccessToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe("getApiBaseUrl", () => {
  it("strips a trailing slash and falls back to localhost", () => {
    // VITE_API_BASE_URL is unset in the test env, so the localhost default is exercised.
    expect(getApiBaseUrl()).toBe("http://localhost:5080");
    expect(getApiBaseUrl().endsWith("/")).toBe(false);
  });
});

describe("ApiError", () => {
  it("carries the status, message and payload", () => {
    const err = new ApiError(422, "TOO_LONG", { error: "TOO_LONG" });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(422);
    expect(err.message).toBe("TOO_LONG");
    expect(err.payload).toEqual({ error: "TOO_LONG" });
  });
});

describe("api() success + auth header", () => {
  it("returns the response on 2xx and attaches the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    setAccessToken("tok-123");

    const res = await api("/api/rooms");

    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5080/api/rooms");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok-123");
    // Always sends the HttpOnly refresh cookie.
    expect(init.credentials).toBe("include");
  });

  it("omits the Authorization header when there is no token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const res = await api("/api/rooms");
    expect(res.ok).toBe(true);
    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as Headers).has("Authorization")).toBe(false);
  });
});

describe("api() error mapping (toApiError)", () => {
  it("maps a JSON { error } body to ApiError.status + .message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { error: "TOO_LONG" }));
    const err = await api("/api/messages").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.message).toBe("TOO_LONG");
    expect(err.payload).toEqual({ error: "TOO_LONG" });
  });

  it("falls back to errors[0] when `error` is absent", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { errors: ["EMPTY", "ignored"] }));
    const err = await api("/api/messages").catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toBe("EMPTY");
  });

  it("uses statusText for an empty body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", { status: 500, statusText: "Internal Server Error" }),
    );
    const err = await api("/api/messages").catch((e) => e);
    expect(err.status).toBe(500);
    expect(err.message).toBe("Internal Server Error");
  });

  it("keeps non-JSON text as the message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 503 }));
    const err = await api("/api/messages").catch((e) => e);
    expect(err.status).toBe(503);
    expect(err.message).toBe("boom");
  });
});

describe("api() 401/403 → single refresh then retry", () => {
  it("on 401, refreshes the cookie, retries once with the new token, and succeeds", async () => {
    fetchMock
      // 1) original request: unauthorized
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTH" }))
      // 2) /api/auth/refresh: mints a new access token
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "fresh-tok" }))
      // 3) retried original request: now ok
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const res = await api("/api/rooms");

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const refreshCall = fetchMock.mock.calls[1];
    expect(refreshCall[0]).toBe("http://localhost:5080/api/auth/refresh");
    expect(refreshCall[1].method).toBe("POST");
    // The retry carries the freshly-minted token.
    const retryInit = fetchMock.mock.calls[2][1];
    expect((retryInit.headers as Headers).get("Authorization")).toBe("Bearer fresh-tok");
  });

  it("when refresh fails, surfaces the original error and does NOT loop", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: "FORBIDDEN" }))
      // refresh rejected — no valid cookie
      .mockResolvedValueOnce(new Response("", { status: 401 }));

    const err = await api("/api/admin").catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    // original + refresh only — the retry never fires, so there's no infinite loop.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not attempt a refresh when retryOnUnauthorized is false", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTH" }));
    const err = await api("/api/rooms", { retryOnUnauthorized: false }).catch((e) => e);
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("apiJson", () => {
  it("parses the JSON body of a successful response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "r1", name: "Sheshi" }));
    const data = await apiJson<{ id: string; name: string }>("/api/rooms/r1");
    expect(data).toEqual({ id: "r1", name: "Sheshi" });
  });

  it("sets Content-Type and serialises the body for a write", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "m1" }));
    await apiJson("/api/messages", { method: "POST", body: { body: "hi" } });
    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ body: "hi" }));
  });

  it("throws ApiError(204, EMPTY_RESPONSE) on a 204 (no body to parse)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const err: unknown = await apiJson("/api/rooms").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(204);
    expect((err as ApiError).message).toBe("EMPTY_RESPONSE");
  });
});

describe("apiNoContent", () => {
  it("resolves without parsing a body on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiNoContent("/api/messages/m1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("propagates an ApiError on failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: "RATE_LIMITED" }));
    const err = await apiNoContent("/api/messages/m1/vote", {
      method: "PUT",
      body: { value: 1 },
      retryOnUnauthorized: false,
    }).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.message).toBe("RATE_LIMITED");
  });
});
