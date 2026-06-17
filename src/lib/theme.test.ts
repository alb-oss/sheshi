import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTheme, getStoredTheme, setTheme, THEME_BOOT_SCRIPT } from "@/lib/theme";

// Theme is persisted under "sheshi:theme" and rendered by toggling the `dark` class on <html>
// (Tailwind's dark variant + the CSS token blocks read off it). Dark is the brand default. These
// tests pin the default, the exact storage key, and the class-toggle behaviour.
const KEY = "sheshi:theme";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(() => window.localStorage.clear());

describe("getStoredTheme", () => {
  it("defaults to dark when nothing is stored (brand default)", () => {
    expect(getStoredTheme()).toBe("dark");
  });

  it("returns light only for the exact 'light' value, dark for anything else", () => {
    window.localStorage.setItem(KEY, "light");
    expect(getStoredTheme()).toBe("light");
    window.localStorage.setItem(KEY, "garbage");
    expect(getStoredTheme()).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("adds the dark class for dark and removes it for light", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("setTheme", () => {
  it("persists under the exact key AND applies the class in one call", () => {
    setTheme("light");
    expect(window.localStorage.getItem(KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    setTheme("dark");
    expect(window.localStorage.getItem(KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("THEME_BOOT_SCRIPT", () => {
  it("reads the same key and treats anything but 'light' as dark (no-flash boot, matches getStoredTheme)", () => {
    expect(THEME_BOOT_SCRIPT).toContain("sheshi:theme");
    expect(THEME_BOOT_SCRIPT).toContain("'light'");
  });
});
