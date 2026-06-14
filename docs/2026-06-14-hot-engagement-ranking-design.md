# HOT highlights: engagement-first ranking with delayed time decay

Date: 2026-06-14
Scope: `server/Sheshi.Api/Features/Messages/HighlightsController.cs` (the `hot` mode only). No API
shape change, no frontend change.

## Problem

HOT currently uses `(score + 0.5·replies) / (ageHours + 2)^1.5` over the newest-200 posts. Two issues
the product owner flagged:
1. **Time dominates.** Gravity 1.5 decays from t=0, so a 41-minute-old post with **1 upvote** outranks
   an 11-hour post with 5 upvotes + 3 replies. HOT behaves like "newest with a nudge."
2. **Engagement is undervalued.** A reply counts as half an upvote, and there is no grace window for a
   post to accumulate engagement before age starts pulling it down.

Goal: **the most-engaged content (upvotes + comments) is the focus**, and time only matters *after ~1
day*, then gently.

## Research (what the standard algorithms do, and why they don't fit)

- **Reddit "hot"**: `log10(score)` + `seconds/45000` — time-dominant, decays from t=0.
- **Hacker News**: `(upvotes-1)^0.8 / (age+2)^1.8` — gravity **1.8**, strongly time-dominant.
- **Lemmy**: `log(max(1, 3+score)) / (time+2)^1.8` — same shape, gravity 1.8.
- **Reddit "best"**: Wilson score — pure quality/confidence, **no time** at all.
- Cross-cutting note from the literature: **comments are a significant but commonly under-weighted
  engagement signal.**

All the "hot" variants decay continuously from submission with high gravity — the opposite of the ask.
"Best" ignores time entirely. So we want a **middle path**: engagement-first, with a *flat grace
window* then a *gentle* decay. (Sources listed at the bottom.)

## Design

```
engagement E = score + COMMENT_WEIGHT · replyCount         // score = up − down; replies = full subtree
recency   R = min(1, (GRACE_HOURS / ageHours)^GRAVITY)      // 1.0 for the first GRACE_HOURS, then gentle
hot       H = E · R
```

Constants (named, tunable):
- `COMMENT_WEIGHT = 1.5` — a comment counts a bit more than an upvote (higher-effort signal; matches the
  owner's "equal or replies a tiny bit more" and the research note above).
- `GRACE_HOURS = 24` — **no time decay for the first day**; ranking is pure engagement.
- `GRAVITY = 0.8` — gentle post-grace decay. A post keeps ≈ 57% of its weight at 2 days, ≈ 21% at 7 days
  (vs Reddit/HN gravity 1.8 which would be ≈ 25% / ≈ 2%).

Behaviour this produces:
- Within 24h, `R = 1` → **rank is exactly total engagement** (a 13-comment thread beats a 5-upvote one;
  a brand-new 1-upvote post no longer leads).
- A 0-vote, 0-reply post scores `0` and cannot lead; a downvoted post goes negative and sinks (kept).
- After a day, age applies *gently*, so a strongly-engaged 3-day post can still out-focus a thin fresh one.

### Candidate pool
Switch the `hot` pool from "newest 200" to **top 200 by raw engagement (vote sum + reply count) over the
last 7 days**, so high-engagement posts are actually candidates regardless of recency (the newest-200
pool silently dropped engaged posts once volume was high). 7-day top-level volume is ~3.7k rows
(of 50k) — the same correlated-aggregate shape already used by `top`, comfortably fast with the existing
`Vote.MessageId` / `Message.ParentId` indexes. Final ranking by `H`, take 10.

## Plan / commits
1. `docs`: this spec.
2. `fix(highlights)`: engagement-first `HotScore` (E·R with grace + gentle gravity) + engagement-based
   7-day candidate pool. Named constants.
3. Regression tests: (a) within 24h a high-comment post outranks a fresher low-engagement one;
   (b) a thin brand-new post does **not** lead; (c) engagement beats recency inside the grace window.

## Out of scope
`top` (Top sot) and `replied` (Më të përgjigjura) are unchanged — they are deliberately single-signal
(votes / replies) over 24h. Only `hot` changes.

## Sources
- Reddit ranking overview — https://medium.com/@niruthiha2000/reddits-ranking-algorithm-for-content-curation-systems-2daa3f33a14f
- "A better ranking algorithm" — https://herman.bearblog.dev/a-better-ranking-algorithm/
- Reddit vs HN study (arXiv) — https://arxiv.org/pdf/1501.07860
- Lemmy ranking algo — https://join-lemmy.org/docs/contributors/07-ranking-algo.html
- Saturn Cloud: Reddit & HN ranking — https://saturncloud.io/blog/how-are-reddit-and-hacker-news-ranking-algorithms-used/
