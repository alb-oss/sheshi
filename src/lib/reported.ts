// Client-side record of which messages this browser has already reported, so the UI can disable
// the report action and show it as done. Reporting itself is a server call; this is just local
// "already did it" memory (append-only — you can't un-report), persisted with a change event so
// every mounted MessageCard stays in sync.
const KEY = "sheshi:reported";
const EVENT = "sheshi:reported-changed";

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function isReported(id: string): boolean {
  return read().has(id);
}

export function markReported(id: string) {
  if (typeof window === "undefined") return;
  const ids = read();
  if (ids.has(id)) return;
  ids.add(id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // storage full / disabled — best-effort, never throw into the UI.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onReportedChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
