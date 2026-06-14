# User karma + profile — design + plan

**Date:** 2026-06-14
**Status:** accepted

## Goal

Give every user a **karma** score (mostly driven by upvotes received, plus activity), surface it on
the API user object, and make the profile page show the user's karma, their posts, and their
comments. Karma is display-only for now; wiring it into the Në Fokus/HOT ranking is a later step.

## Karma — computed on read, not stored

No denormalized column / migration / increment hooks. Karma is derived from existing data, so it's
always correct and there's nothing to backfill or keep in sync:

```
netVotes      = Σ Vote.Value over the user's non-deleted messages   (up = +1, down = -1)
contributions = count of the user's non-deleted messages            (posts + replies)
karma         = UpvoteWeight * netVotes + contributions             (UpvoteWeight = 2)
```

Upvotes are the dominant lever (weight 2, and they compound for popular users); every contribution
(post or reply) adds 1 so activity matters too. Constants live in `UserStatsService` and are easy to
tune when karma later feeds ranking. Both queries hit the existing `Messages.AuthorId` index.

**Where computed:** in `GET /api/me` only (not in `CreateUserDtoAsync`), so login/refresh stay lean.
Clients already read `/api/me` as the authoritative user, so `karma` defaults to `0` on the
login/refresh payloads and is filled in on the profile load. `UserDto` gains `int Karma = 0`.

## Profile lists — messages by author

New endpoint, mirrors the room cursor-paging (newest-first, excludes deleted):

```
GET /api/users/{id}/messages?type=posts|comments&limit=&cursor=
```

`type=comments` → `ParentId != null`; anything else → posts (`ParentId == null`). Returns
`CursorPageDto<MessageDto>` enriched with score/reply_count/my_vote like every other feed, so the web
can render them with the existing `MessageCard`. Anonymous-allowed (profiles are public); the caller's
vote is included when authenticated.

## Frontend

- **Web** `/profili` (today an account-settings page): add a karma stat to the identity card and a
  Posts / Comments tabbed list below, fetched from the new endpoint and rendered with `MessageCard`.
- **Mobile** `(tabs)/profili.tsx`: show a karma stat on the user card and a Posts / Comments toggle
  listing the user's messages with `PostCard`.
- `ApiUser` (web `hooks/use-auth.ts`, mobile `types.ts`) gains `karma: number`.

## Plan (atomic commits)

1. **docs** — this file.
2. **feat(api): karma + messages-by-author** — `UserDto.Karma`; `UserStatsService.GetKarmaAsync`;
   `/api/me` fills karma; `MessageService.ListUserMessagesAsync`; `UsersController`
   `GET /api/users/{id}/messages`. + tests (karma reflects net votes + activity; posts vs comments).
3. **feat(web): profile shows karma + posts/comments** — `listUserMessages` in sheshi.ts; `/profili`
   karma stat + tabs.
4. **feat(mobile): profile shows karma + posts/comments** — `listUserMessages` in api.ts; profile
   karma + toggle.

## Out of scope

- Karma in ranking (Në Fokus/HOT) — later.
- Public profiles for *other* users / `@username` routes (endpoint is already reusable for it).
- Denormalized karma / caching — revisit only if `/api/me` shows up hot.
