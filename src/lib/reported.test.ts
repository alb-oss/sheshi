import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isReported, markReported, onReportedChanged } from "@/lib/reported";

// `reported` is a localStorage-backed, append-only record of which messages this browser has already
// reported, so every mounted MessageCard can disable the report action and stay in sync via a change
// event. These tests pin the on-disk key shape, the append-only contract, and cross-card notification.
const KEY = "sheshi:reported";

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("reported persistence + key shape", () => {
  it("starts with nothing reported", () => {
    expect(isReported("m1")).toBe(false);
  });

  it("markReported persists under the exact key as a JSON id array", () => {
    markReported("m1");
    expect(isReported("m1")).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify(["m1"]));
  });

  it("is append-only — re-marking is idempotent and never duplicates", () => {
    markReported("m1");
    markReported("m1");
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify(["m1"]));
  });

  it("survives a reload (the next read picks the value back up from storage)", () => {
    markReported("m1");
    markReported("m2");
    // A fresh read goes straight to localStorage — no in-memory caching to get stale.
    expect(isReported("m1")).toBe(true);
    expect(isReported("m2")).toBe(true);
  });
});

describe("reported change notification", () => {
  it("notifies subscribers on a new report and stops after unsubscribe", () => {
    const listener = vi.fn();
    const off = onReportedChanged(listener);
    markReported("m1");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    markReported("m2");
    expect(listener).toHaveBeenCalledTimes(1); // no further calls after unsubscribe
  });

  it("does not fire the change event when re-marking an already-reported id", () => {
    markReported("m1");
    const listener = vi.fn();
    onReportedChanged(listener);
    markReported("m1"); // already reported → no-op, no event
    expect(listener).not.toHaveBeenCalled();
  });
});
