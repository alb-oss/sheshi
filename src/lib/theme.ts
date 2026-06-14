// Light/dark theme: toggles the `dark` class on <html> (Tailwind's dark variant + the CSS
// token blocks in styles.css read off it) and persists the choice. Dark is the brand default.
export type Theme = "dark" | "light";

const KEY = "sheshi:theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setTheme(theme: Theme) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

// Inline-able snippet for the document head so the stored theme applies before first paint
// (no flash). Kept tiny and dependency-free.
export const THEME_BOOT_SCRIPT =
  "try{var t=localStorage.getItem('sheshi:theme');document.documentElement.classList.toggle('dark',t!=='light')}catch(e){}";
