# Room media gallery (swipeable lightbox)

**Date:** 2026-06-15
**Status:** in progress

## Goal

Tap an image/video → full-screen viewer that **swipes through all media in the room** (images + videos,
chronological), even items far apart in the feed — WhatsApp-style. Today the viewer is a single-image
overlay with no prev/next, and videos only play inline.

## Design

- **Server** `GET /api/rooms/{id}/media` (anonymous, like the feed) → a flat list
  `[{ message_id, kind: "image"|"video", url, created_at, author }]` for every non-deleted media in the
  room, chronological (oldest→newest), capped at 1000. One indexed query; mirrors the feed query.
- **Web `MediaViewer`** (new) — full-screen overlay. Fetches the room media via
  `useQuery(["room-media", roomId])` (cached); opens instantly on the tapped item (a `fallback` shown
  until the list loads, then it jumps to that item's index). Swipe (touch) / ← → (keys) / on-screen
  arrows; index counter + author caption; preloads neighbouring images; images `object-contain`, videos
  `controls autoPlay`. Closes on ×/Escape/backdrop.
- **`MessageCard`** — tapping an image **or** a video opens the shared `MediaViewer` (replacing the old
  single-image overlay). In-feed videos become a tappable poster (muted, no controls, play badge) so the
  interaction is uniform (tap → gallery).

Room-scoped (so in a thread it still shows the whole room's media). No model changes.

## Verification

- `curl /api/rooms/{id}/media` after posting an image + a video → both returned, chronological, right kind.
- Browser: tap media → viewer opens on it; swipe/arrows move across far-apart items; counter correct;
  video plays; close works. `tsc`+`eslint`+`vite build` + server tests clean.
