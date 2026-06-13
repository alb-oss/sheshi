# Reddit-style thread/comment UI — design

**Branch:** `feat/reddit-thread-ui` (off `main`) · 2026-06-14

## Why
A multi-agent comparison of the current rewrite against the pre-rewrite app (git
`f5270ad`) and against Reddit found the rewrite had drifted away from a Reddit-like
comment thread: threadlines at ~6% opacity (invisible), 12px/level indent (nesting reads
flat), the vote control buried as a faint inline `↑ 0`, and no Save. The old version —
which the user remembers as "more like reddit" — had crisp 2px threadlines, 18px/level
indent, and a consistent action vocabulary. This restores (and goes past) that feel while
keeping the current dark "civic dispatch" brand.

## Scope (this PR — frontend only)
1. **Left vote rail.** Move voting out of the horizontal action row into a vertical column
   on the far left of every `MessageCard` (root + replies): up-arrow (`ArrowBigUp`) on top,
   the score beneath it — the Reddit silhouette. Upvoted = primary/red. The rail reserves a
   down-arrow slot for the optional follow-up below.
2. **Visible threadlines.** New `--thread-line` token (~20% vs the 8% `--border`), exposed
   as `bg-thread-line`. The `ReplyBranch` guide line uses it and brightens to `primary/40`
   on hover of its branch — Reddit's hover-highlight.
3. **Deeper, consistent indentation.** ~16px per nesting level (was 12px and 0 at depth 1),
   clamped, applied at every level so hierarchy reads.
4. **Head-anchored collapse.** The vertical threadline itself is the collapse affordance
   (click to fold a subtree, hover highlights); when collapsed the node shows a compact
   `[+] N përgjigje` control at its head — closer to Reddit's `[–]`/`[+]`.
5. **Quieter comment chrome.** Smaller avatar moved inline into the meta line (text-first),
   action row reduced to a consistent muted set.
6. **Save (bring back).** Client-side bookmark in `localStorage` (the pre-rewrite behaviour —
   it was never a server feature), filled when saved. New `src/lib/saved.ts`.

The user's earlier explicit preference — Share as an icon-only circular button — is kept;
Save mirrors it (icon-only) so the row stays consistent with their taste.

## Deferred (optional follow-up PR — backend)
**Functional downvote (`▼`).** Requires a real data change: a `Value` (+1/-1) column on
`Vote`, score = `SUM(value)` (not `COUNT`), the `MessageDto` contract (`Upvotes`→net
`Score`, `Voted` bool→`MyVote` 1/0/-1), the two vote endpoints, the realtime `vote_changed`
payload, and the Hot ranking — plus an EF migration applied to the DB. The old version the
user liked had no downvote, so this is intentionally split out; the rail is built to accept
the down-arrow the moment the backend lands.

## Files
- `src/styles.css` — add `--thread-line` + `--color-thread-line`.
- `src/components/MessageCard.tsx` — left vote rail; inline small avatar; action row =
  reply · share · save · report/delete (vote removed from row); Save wired to `saved.ts`.
- `src/routes/tema.$messageId.tsx` (`ReplyBranch`) — brighter clickable threadline, deeper
  indent, head-anchored `[+]`/`[–]` collapse.
- `src/lib/saved.ts` — localStorage bookmark store (get/has/toggle + change event).
- `src/i18n/sq.ts` — `save`/`saved` strings.

## Verification
`tsc --noEmit` clean (modulo the pre-existing `__root.tsx:124`); drive the thread in
Playwright and screenshot for the before/after.
