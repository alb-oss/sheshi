// Robust "copy to clipboard" — ported from the pre-rewrite app. Prefers the async
// Clipboard API (only in a secure context, time-boxed so a hung permission prompt can't
// wedge the UI), and falls back to a hidden-textarea + execCommand selection copy for
// http/older browsers. Returns whether the copy succeeded so callers can toast accurately.
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("COPY_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await withTimeout(navigator.clipboard.writeText(value), 800);
      return true;
    } catch {
      // Fall through to the legacy selection copy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
