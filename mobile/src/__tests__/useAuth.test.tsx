/**
 * useAuth — resolves the current user from the stored token on mount, flips to (null, ready) when
 * there is no token, falls back to null on a failed /api/me, and re-fetches when auth changes
 * (login/logout via subscribeAuth). We drive it through the real token store (AsyncStorage mock)
 * and a hand-rolled fake fetch; no auth/network is mocked beyond the fetch boundary.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderHook, waitFor, act } from "@testing-library/react-native";
import { clearTokens, setTokens } from "../api";
import { useAuth } from "../useAuth";

const ME = {
  id: "u1",
  email: "a@b.c",
  username: "al",
  display_name: "Al",
  avatar_url: null,
  roles: ["user"],
};

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

let fetchCalls: string[] = [];
function installFetch(handler: (url: string) => Response) {
  fetchCalls = [];
  (globalThis as { fetch: unknown }).fetch = ((url: string) => {
    fetchCalls.push(url);
    return Promise.resolve(handler(url));
  }) as typeof fetch;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearTokens();
});

it("becomes ready with no user when there is no stored token (and never calls /api/me)", async () => {
  installFetch(() => res(200, ME));
  const { result } = renderHook(() => useAuth());

  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.user).toBeNull();
  expect(fetchCalls).toHaveLength(0);
});

it("loads the user from /api/me when a token is present", async () => {
  await AsyncStorage.setItem("sheshi:tokens", JSON.stringify({ accessToken: "AT", refreshToken: "RT" }));
  installFetch((url) => (url.endsWith("/api/me") ? res(200, ME) : res(404, {})));

  const { result } = renderHook(() => useAuth());

  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.user).toMatchObject({ id: "u1", username: "al" });
  expect(fetchCalls.some((u) => u.endsWith("/api/me"))).toBe(true);
});

it("clears the user when /api/me fails (token present but invalid)", async () => {
  await AsyncStorage.setItem("sheshi:tokens", JSON.stringify({ accessToken: "BAD", refreshToken: "BAD" }));
  // 401 with no usable refresh path -> request() throws -> hook swallows to (null, ready).
  installFetch(() => res(401, { error: "nope" }));

  const { result } = renderHook(() => useAuth());

  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.user).toBeNull();
});

it("re-fetches the user when auth state changes (login after mount)", async () => {
  installFetch((url) => (url.endsWith("/api/me") ? res(200, ME) : res(200, {})));
  const { result } = renderHook(() => useAuth());

  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.user).toBeNull();

  // setTokens notifies subscribers; the hook's refresh runs again and finds the user.
  await act(async () => {
    await setTokens({ accessToken: "AT", refreshToken: "RT" });
  });

  await waitFor(() => expect(result.current.user).toMatchObject({ id: "u1" }));
});
