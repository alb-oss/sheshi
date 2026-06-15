# Mobile composer — make the web composer feel like a real app

**Date:** 2026-06-15
**Status:** in progress
**Scope:** `src/components/Composer.tsx` (web, used on mobile browsers). The native Expo composer
(`mobile/src/components/Composer.tsx`) is out of scope.

## Problems (mobile)

1. **The attach (image) button is unreachable.** The whole toolbar — attach · counter · send — is
   `hidden` until the composer is "expanded" (`expanded ? "flex" : "hidden sm:flex"`, line 321), and
   `expanded` requires focusing/typing first (line 205). So on a phone the image button doesn't exist
   until you tap the field, and even then it's a **36px** target (`h-9 w-9`) with a faint 16px icon.
2. **Duplicate `id="composer-attach"`** (lines 324/334) — if two composers ever mount on one page the
   `<label htmlFor>` resolves to the wrong/first input and the picker won't open.
3. **Enter sends** (line 315) — on a soft keyboard that blocks newlines and fires sends.
4. **No keyboard handling / safe area** — bottom-docked in an `h-dvh` column with no
   `interactive-widget` or `env(safe-area-inset-bottom)`, so it can sit behind the keyboard or under the
   home indicator.
5. **Small secondary targets** — remove-attachment / cancel are 24px.

## Design (real-app composer)

A **persistent single row**: attach on the left, input pill in the middle, send on the right; staged
attachment/reply previews stack above it.

```
[ reply / image / video preview chips ]            ← above, full width
[ ＋ ]  ⌈ Shkruaj një mesazh…            ⌋  [ ➤ ]    ← always visible, 44px targets
```

- **Attach always visible**, `h-11 w-11` (44px), left of the input. Keep `<label htmlFor>` (iOS-safe)
  but give the file input a **`useId()` id** so instances never collide.
- **Send always visible**, `h-11 w-11` icon button, enabled when there's content (drops the
  expand-gated toolbar entirely — the composer is always present, like a chat app).
- **Enter = newline on touch**, send via the button; keep Enter-to-send on desktop
  (`matchMedia("(pointer: coarse)")`).
- **Keyboard + safe area**: add `interactive-widget=resizes-content` to the viewport meta
  (`__root.tsx`) so the layout shrinks above the keyboard on Chromium, and
  `pb-[max(0.5rem,env(safe-area-inset-bottom))]` on the docked bar.
- **Bigger targets**: send/attach 44px; remove-/cancel-× 32px.
- Counter only shows the remaining count near the limit (declutter).

Preserves: autosize, one-attachment-at-a-time, previews, reply-context chip, `compact` inline-reply
variant, the logged-out sign-in prompt.

## Verification

- Mobile viewport (≈390px): attach button visible and tappable **without** focusing first; picker opens.
- Type → Enter inserts a newline (touch); the send button posts. Desktop: Enter still sends.
- Send/attach are 44px; layout sits above the keyboard; nothing clipped by the home indicator.
- `tsc` + `eslint` + `vite build` clean.

## Plan

1. **docs** — this file.
2. **feat(web): mobile-first composer** — rebuild the input row + viewport meta.
