// Client-side "saved / bookmark" store. Save was never a server feature — the pre-rewrite
// app kept it in localStorage — so this restores that behaviour: a string set of message ids
// persisted locally, with a change event so every mounted MessageCard stays in sync.
const KEY = "sheshi:saved";
const EVENT = "sheshi:saved-changed";

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function write(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // storage full / disabled — saving is best-effort, never throw into the UI.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function isSaved(id: string): boolean {
  return read().has(id);
}

// All saved message ids, most-recently-saved first (a Set preserves insertion order).
export function savedIds(): string[] {
  return [...read()].reverse();
}

// Toggle and return the new saved-state for the given id.
export function toggleSaved(id: string): boolean {
  const ids = read();
  const next = !ids.has(id);
  if (next) ids.add(id);
  else ids.delete(id);
  write(ids);
  return next;
}

// Subscribe to saved-set changes (cross-card sync within the tab). Returns an unsubscribe fn.
export function onSavedChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
