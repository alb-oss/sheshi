# Karma — make it hard and farm-resistant

**Date:** 2026-06-15
**Status:** in progress

## Problem

Karma is trivial to gather. Today (`UserStatsService.GetKarmaAsync`):

```
karma = 2 × (net votes on your messages) + 1 × (count of your non-deleted messages)
```

- **+1 for every post/reply** — you gain karma just by posting, no one else needed (post 13× → 13 karma).
- **Self-votes count** — the vote endpoint allows upvoting your own message, so each self-upvote adds +2.

A lonely user farmed 13 karma solo. It should be **hard** — earned only when the community upvotes you.

## How Reddit does it (best practice)

Karma comes **only from upvotes other people give your posts/comments**; posting earns nothing; your own
vote never counts; very high-scoring posts have **diminishing returns** (anti-farm).

## Design (chosen: "even harder — dampened")

```
per message:  s = net upvotes from OTHER users (self-votes excluded)
              contribution = s < 1 ? 0
                           : min(s, KNEE) + floor(sqrt(s − KNEE))     // 1:1 up to KNEE, √ beyond
karma        = max(0, Σ contributions)         // KNEE = 10
```

- **No points for posting** — only votes received count.
- **Self-votes excluded** (`v.UserId != userId`) — kills solo farming. (Self-voting still affects the
  post's displayed score; that's a separate ranking concern, out of scope here.)
- **Threshold**: a message needs ≥1 net upvote from someone else to count (downvoted/ignored posts give 0,
  never negative).
- **Diminishing returns** above the knee: 1:1 for normal posts, sub-linear when a post goes viral, so one
  hit can't mint karma. Examples: net 1→1, 10→10, 19→13, 110→20, 1010→41.

Effect: a lonely user posting all day = **0**; ~13 karma now requires real community traction (e.g. 13
posts each upvoted by others, or fewer well-received ones, dampened).

The curve is a pure, unit-tested static function (`KarmaCurve`) so the economy is verifiable in isolation;
the service just feeds it per-message net scores from one grouped query. Karma stays computed on read (no
denormalized column → can't drift).

## Tests

- Unit (`KarmaCurve`): the curve values, the <1 floor, and the knee/√ dampening.
- Integration (`CoreApiTests`): posting alone → 0; a self-upvote → 0; an upvote **from another user** →
  counts (the prior `=4` case becomes `=1`).

## Plan

1. **docs** — this file.
2. **feat(api): karma = dampened net upvotes from others** — `KarmaCurve` + `UserStatsService`, tests.
