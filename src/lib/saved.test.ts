import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSaved, onSavedChanged, savedIds, toggleSaved } from "@/lib/saved";

// `saved` is a localStorage-backed pub/sub store for client-side bookmarks (save was never a server
// feature). These tests pin three contracts the MessageCards depend on: the EXACT on-disk key shape
// (so a future rename can't silently orphan everyone's saves), cross-card sync via the change event,
// and that the set survives a "reload" — i.e. the next read picks the value back up from storage.
const KEY = "sheshi:saved";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("saved persistence + key shape", () => {
  it("starts with nothing saved", () => {
    expect(isSaved("m1")).toBe(false);
    expect(savedIds()).toEqual([]);
  });

  it("toggleSaved returns the new state and persists under the exact key as a JSON id array", () => {
    expect(toggleSaved("m1")).toBe(true);
    expect(isSaved("m1")).toBe(true);
    // The on-disk shape is a JSON array of ids under "sheshi:saved" — assert it verbatim.
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify(["m1"]));
  });

  it("toggling the same id again removes it and rewrites storage", () => {
    toggleSaved("m1");
    expect(toggleSaved("m1")).toBe(false);
    expect(isSaved("m1")).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify([]));
  });

  it("survives a reload — a value written to storage is read back by a fresh call", () => {
    // Simulate a prior session having persisted saves (a fresh module read must pick these up).
    window.localStorage.setItem(KEY, JSON.stringify(["a", "b"]));
    expect(isSaved("a")).toBe(true);
    expect(isSaved("b")).toBe(true);
    expect(isSaved("c")).toBe(false);
  });

  it("savedIds lists ids most-recently-saved first", () => {
    toggleSaved("first");
    toggleSaved("second");
    toggleSaved("third");
    // A Set preserves insertion order; savedIds reverses it → newest first.
    expect(savedIds()).toEqual(["third", "second", "first"]);
  });

  it("tolerates corrupt JSON in storage by reading an empty set (never throws)", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(isSaved("m1")).toBe(false);
    expect(savedIds()).toEqual([]);
  });
});

describe("saved change notifications (cross-card sync)", () => {
  it("notifies subscribers on every toggle", () => {
    const listener = vi.fn();
    const off = onSavedChanged(listener);
    toggleSaved("m1");
    toggleSaved("m1");
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const off = onSavedChanged(listener);
    toggleSaved("m1");
    off();
    toggleSaved("m2");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports multiple independent subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onSavedChanged(a);
    const offB = onSavedChanged(b);
    toggleSaved("m1");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});
