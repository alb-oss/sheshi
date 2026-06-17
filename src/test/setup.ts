// Vitest global setup: jest-dom matchers, a DOM teardown between tests so component state never
// leaks across cases, and a real in-memory localStorage.
//
// Why the localStorage polyfill: under Node 26 + jsdom, `window.localStorage` resolves to undefined
// (Node's experimental built-in localStorage interferes with jsdom's, which is only exposed when a
// backing file is provided). The app's draft autosave and the token-store migration both touch
// localStorage, so we install a spec-faithful in-memory Storage. It's a hand-rolled fake (no library)
// and is reset before every test for isolation. matchMedia is provided by jsdom 29 already, but we
// guard-polyfill it too so the Composer's `(pointer: coarse)` check can't throw on a thinner DOM.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }
}

function installStorage(prop: "localStorage" | "sessionStorage") {
  Object.defineProperty(window, prop, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installStorage("localStorage");
  installStorage("sessionStorage");
});

afterEach(() => {
  cleanup();
});

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
