import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postMessage, setVote, SheshiError } from "@/lib/sheshi";
import { clearAccessToken } from "@/lib/token-store";

// sheshi.ts wraps the raw ApiError from api-client into a typed SheshiError with a closed-set `code`,
// which the UI maps to a localized toast. The private mappers (toMessageMutationError / apiErrorCode)
// are exercised through the exported mutations against a fake `fetch`, asserting the status/payload →
// SheshiError.code contract that the Composer and VoteControl depend on.

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

describe("postMessage client-side input validation (before any fetch)", () => {
  it("throws EMPTY when body is blank and there is no attachment", async () => {
    const err = await postMessage({ room_id: "r1", body: "   " }).catch((e) => e);
    expect(err).toBeInstanceOf(SheshiError);
    expect((err as SheshiError).code).toBe("EMPTY");
    // Validation is local — the network was never touched.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws TOO_LONG when body exceeds 2000 characters", async () => {
    const err = await postMessage({ room_id: "r1", body: "x".repeat(2001) }).catch((e) => e);
    expect((err as SheshiError).code).toBe("TOO_LONG");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows exactly 2000 characters (boundary) and trims before posting", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "m1", body: "x" }));
    await postMessage({ room_id: "r1", body: `  ${"x".repeat(2000)}  ` });
    const init = fetchMock.mock.calls[0][1];
    const sent = JSON.parse(init.body as string);
    expect(sent.body).toBe("x".repeat(2000));
    expect(sent.room_id).toBe("r1");
  });

  it("accepts an empty body when an image is attached (sends multipart)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "m1" }));
    const image = new File(["bytes"], "pic.png", { type: "image/png" });
    await postMessage({ room_id: "r1", body: "", image });
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("image")).toBe(image);
  });
});

// status / payload-code → SheshiError.code, as a data-driven table (engineering-style: behavior table
// + a single runner, not branching test logic).
const SERVER_ERROR_CASES: ReadonlyArray<{
  label: string;
  status: number;
  payload: unknown;
  expected: SheshiError["code"];
}> = [
  { label: "401 → UNAUTH", status: 401, payload: { error: "UNAUTH" }, expected: "UNAUTH" },
  {
    label: "429 → RATE_LIMITED",
    status: 429,
    payload: { error: "RATE_LIMITED" },
    expected: "RATE_LIMITED",
  },
  { label: "422 TOO_LONG", status: 422, payload: { error: "TOO_LONG" }, expected: "TOO_LONG" },
  { label: "422 EMPTY", status: 422, payload: { error: "EMPTY" }, expected: "EMPTY" },
  {
    label: "INVALID_IMAGE",
    status: 422,
    payload: { error: "INVALID_IMAGE" },
    expected: "INVALID_IMAGE",
  },
  {
    label: "UNSUPPORTED_IMAGE_TYPE → INVALID_IMAGE",
    status: 415,
    payload: { error: "UNSUPPORTED_IMAGE_TYPE" },
    expected: "INVALID_IMAGE",
  },
  {
    label: "IMAGE_TOO_LARGE → INVALID_IMAGE",
    status: 413,
    payload: { error: "IMAGE_TOO_LARGE" },
    expected: "INVALID_IMAGE",
  },
  {
    label: "INVALID_VIDEO",
    status: 422,
    payload: { error: "INVALID_VIDEO" },
    expected: "INVALID_VIDEO",
  },
  {
    label: "VIDEO_TOO_LARGE → INVALID_VIDEO",
    status: 413,
    payload: { error: "VIDEO_TOO_LARGE" },
    expected: "INVALID_VIDEO",
  },
  {
    label: "UPLOAD_FAILED code",
    status: 500,
    payload: { error: "UPLOAD_FAILED" },
    expected: "UPLOAD_FAILED",
  },
  {
    label: "502 (any) → UPLOAD_FAILED",
    status: 502,
    payload: { error: "BAD_GATEWAY" },
    expected: "UPLOAD_FAILED",
  },
  {
    label: "errors[0] EMPTY (array form) → EMPTY",
    status: 400,
    payload: { errors: ["EMPTY"] },
    expected: "EMPTY",
  },
];

describe("postMessage server-error → SheshiError.code mapping", () => {
  for (const c of SERVER_ERROR_CASES) {
    it(c.label, async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(c.status, c.payload));
      const err = await postMessage({
        room_id: "r1",
        body: "hello",
        // Disable the api-client refresh-retry so a 401 surfaces directly (no second fetch needed).
      }).catch((e) => e);
      expect(err).toBeInstanceOf(SheshiError);
      expect((err as SheshiError).code).toBe(c.expected);
      expect((err as SheshiError).status).toBe(c.status);
    });
  }

  it("re-throws the raw ApiError unchanged for an unmapped error", async () => {
    // 400 with an unrecognized code is not a SheshiError — the caller sees the generic ApiError.
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "SOMETHING_ELSE" }));
    const err = await postMessage({ room_id: "r1", body: "hello" }).catch((e) => e);
    expect(err).not.toBeInstanceOf(SheshiError);
    expect(err.status).toBe(400);
  });
});

describe("setVote error mapping", () => {
  it("maps 401 → UNAUTH", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTH" }));
    const err = await setVote("m1", 1).catch((e) => e);
    expect(err).toBeInstanceOf(SheshiError);
    expect((err as SheshiError).code).toBe("UNAUTH");
  });

  it("maps 429 → RATE_LIMITED", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: "RATE_LIMITED" }));
    const err = await setVote("m1", -1).catch((e) => e);
    expect((err as SheshiError).code).toBe("RATE_LIMITED");
  });

  it("succeeds (no throw) on 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(setVote("m1", 0)).resolves.toBeUndefined();
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ value: 0 });
  });
});
