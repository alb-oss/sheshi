# Mobile dock — floating frosted-glass pill

**Date:** 2026-06-15
**Status:** done

Refines the mobile dock (`AppShell.tsx`) from a solid edge-to-edge bar into a **floating,
rounded, frosted-glass pill** (chosen direction), with **no animation**:

- The `<nav>` is a transparent, padded wrapper (`px-3` + safe-area `pb`); the dock is a detached
  `rounded-[1.65rem]` panel — `bg-background/70` (→ `/55` where `backdrop-filter` is supported) +
  `backdrop-blur-2xl` + a hairline border + a soft drop shadow, with a faint top-edge glass highlight.
- Active indicator is a **static** soft `bg-primary/15` pill with a glow under the current tab — no
  slide, squash, or sheen (the earlier "liquid glass" animation + its `dock-liquid`/`dock-sheen`
  keyframes were removed).
- Stays a flex child (in flow) so the docked composer still sits above it; respects the home-indicator
  safe area.

Note: kept in flow (not a fixed overlay) so it never covers the composer; the translucency gives the
floating-glass read without re-architecting the per-page scroll/composer layout.
