import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
  subscribeTokenStore,
} from "@/lib/token-store";

// The access token is an IN-MEMORY-ONLY credential (see the module's header comment): it must never
// be written to localStorage or sessionStorage, so an XSS can't lift a durable token. These tests
// assert both the basic set/get/clear contract AND that security invariant explicitly.
afterEach(() => {
  clearAccessToken();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("token-store set/get/clear", () => {
  it("starts empty", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("returns the token after setAccessToken", () => {
    setAccessToken("jwt-abc");
    expect(getAccessToken()).toBe("jwt-abc");
  });

  it("overwrites a previously stored token", () => {
    setAccessToken("first");
    setAccessToken("second");
    expect(getAccessToken()).toBe("second");
  });

  it("clearAccessToken resets to null", () => {
    setAccessToken("jwt-abc");
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it("setAccessToken(null) clears the token", () => {
    setAccessToken("jwt-abc");
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});

describe("token-store security contract", () => {
  it("never writes the access token to localStorage", () => {
    const localSet = vi.spyOn(window.localStorage, "setItem");
    const sessionSet = vi.spyOn(window.sessionStorage, "setItem");
    setAccessToken("super-secret-jwt");
    clearAccessToken();
    // No write to ANY web storage at all, and certainly not the token value.
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    localSet.mockRestore();
    sessionSet.mockRestore();
  });

  it("does not persist the token anywhere JS-readable", () => {
    setAccessToken("leak-me-if-you-can");
    const dump = JSON.stringify({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
    });
    expect(dump).not.toContain("leak-me-if-you-can");
  });
});

describe("token-store subscribe/notify", () => {
  it("notifies subscribers on set and clear", () => {
    const listener = vi.fn();
    subscribeTokenStore(listener);
    setAccessToken("x");
    clearAccessToken();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTokenStore(listener);
    setAccessToken("x");
    unsubscribe();
    setAccessToken("y");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports multiple independent subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeTokenStore(a);
    const unsubscribeB = subscribeTokenStore(b);
    setAccessToken("x");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubscribeB();
  });
});
