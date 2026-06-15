# Mobile dock — iPhone-style "liquid glass" active indicator

**Date:** 2026-06-15
**Status:** done
**Scope:** the mobile bottom dock in `src/components/AppShell.tsx` (md:hidden). Pure CSS — no animation lib.

## Before

Each tab only swapped text colour on active; no indicator, no motion.

## After

A frosted-glass active **pill** sits behind the current tab and **springs** to the newly selected tab,
with a **squash-and-stretch** as it settles and a **sheen** that sweeps across on each switch — the
"liquid glass" feel, different-looking on every change.

- The dock renders from a `dockTabs` array; `dockActive` is the **last** matching tab so the specific
  room ("Live" = `/dhoma/sheshi`) wins over the broader "Dhoma" match.
- Indicator = an absolutely-positioned span, width `100%/N`, `translateX(activeIndex * 100%)` with a
  spring `cubic-bezier(0.34,1.6,0.5,1)` transition — equal-width columns mean no measuring.
- The inner glass pill (`bg-primary/12` + `backdrop-blur` + `border-primary/30` + glow + top sheen) is
  **re-keyed by the active index**, so its `dock-liquid` squash + `dock-sheen` sweep keyframes replay on
  every switch.
- Active tab icon lifts + scales (`-translate-y-0.5 scale-110`, springy).
- Respects `prefers-reduced-motion` (`motion-reduce:` disables the transition/animations) and adds
  `pb-[env(safe-area-inset-bottom)]` so the dock clears the home indicator.

Keyframes (`dock-liquid`, `dock-sheen`) live in `styles.css` next to the existing `sheshi-pop`.

## Verification

- 390px: indicator renders as a frosted pill on the active tab; `translateX` matches the active index
  (fokus → 200%, profili → 300%); active tab is `/profili`. tsc + eslint + vite build clean.
