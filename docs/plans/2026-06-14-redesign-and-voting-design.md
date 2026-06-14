# Sheshi — voting model + total frontend redesign

**Branch(es):** `feat/voting-and-redesign` (backend) → `feat/frontend-redesign` (UI) · 2026-06-14

## 1. Voting (backend, PR A)
Reddit-style up/down with a real algorithm. Today votes are upvote-only (a `Vote` row,
`upvotes = COUNT`).

- **`Vote.Value`** `smallint` (+1 / −1), default +1 (existing rows were upvotes). Migration.
- **Score = `SUM(Value)`** per message (can go negative). Per-caller **`MyVote`** ∈ {−1,0,1}.
- **DTO contract** (snake_case): `upvotes`+`voted` → **`score`** (int) + **`my_vote`** (int).
- **Endpoint:** `PUT /messages/{id}/vote` body `{ "value": 1 | -1 | 0 }` — upserts the caller's
  vote; `0` clears it. (Replaces the old PUT-upvote / DELETE pair.) Realtime `vote_changed`
  now carries the net `score`.
- **Hot ranking = Reddit's formula:** `sign(s)·log10(max(|s|,1)) + (epoch − 1134028003)/45000`,
  `s = score`. `top` orders by `score`; `replied` by subtree reply_count.
- Regression tests: net score with a downvote, `my_vote` direction, idempotent re-vote.

## 2. Total frontend redesign (PR B)
Throw out the flat, hard-to-read thread. New cohesive system, dark, fast, **super smooth**.

### Design language — "Sheshi Live"
- **Palette (dark, layered):** bg `#0a0b0f`, surface `#14161d`, raised `#1d2029`, hairline
  border `rgba(255,255,255,.07)`. Text `#f3f4f7`, muted `#9aa0ad`. **Accent = Albanian red**
  `#f5333f` (brand, primary, upvote). **Indigo `#6c8cff`** = downvote + links/secondary.
- **Type:** display **Bricolage Grotesque** (characterful), body **Hanken Grotesk** (clean,
  readable) — both Google Fonts; drop Space Grotesk/DM Sans.
- **Shape:** softer — `10px` cards, `8px` controls (was a flat 2px brutalism).
- **Motion (the "smooth"):** 150–200ms ease on every interactive state; vote tap = arrow
  scale-pop + count cross-fade; new realtime items slide+fade in; collapse = height/opacity
  ease; hover lifts. A shared `--ease`/duration scale + a few keyframes.

### Components
- **VoteControl** — compact ▲ / score / ▼ (up=red, down=indigo, filled on `my_vote`),
  optimistic + animated; used inline in the comment action area (Reddit image #7).
- **Comment (MessageCard)** — avatar + name·time header, body, action row
  (vote · reply · share · save · …), head `[–]/[+]` collapse, clear thread guide line.
- **Feed / Thread / Composer / Shell / Highlights** — restyled to the new tokens; one
  visible composer at a time; smooth list transitions.

## Plan
PR A backend voting (migration auto-applies in dev) → PR B frontend redesign. `tsc` clean,
`dotnet test` green, driven in-browser before each merge.
