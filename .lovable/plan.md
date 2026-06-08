# Sheshi — Build Plan

A mobile-first, real-time civic chat for Albanian users. Three vertical slices, shipped in order so the app is usable at the end of each.

## Stack (locked, no alternatives)
- TanStack Start (SSR React) + TanStack Query
- Supabase (Postgres, Auth, Realtime, Storage) via Lovable Cloud
- shadcn/ui + Radix, Tailwind tokens only
- Albanian UI strings throughout

## Design direction (single)
- Primary: deep red `oklch` mapped from `#990000`
- Surfaces: off-white `#FAFAF9` / dark neutral text
- Type: shadcn defaults, left-aligned
- Mobile-first: bottom tab bar (Dhoma / Live / Në Fokus / Profili); desktop: 3-column (rooms | chat | highlights)

## Phase 1 — Foundation & schema
1. Enable Lovable Cloud.
2. Migration creates:
   - `profiles` (id → auth.users, username, display_name, avatar_url, created_at) + trigger on signup
   - `app_role` enum (`user`, `moderator`, `admin`) + `user_roles` table + `has_role()` SECURITY DEFINER
   - `rooms` (id, slug unique, name, description) — seeded with `sheshi`, `vjosa-narta`, `tirana`, `korca`, `shkodra`
   - `messages` (id, room_id, author_id, parent_id nullable for replies, body, image_url nullable, created_at, deleted_at)
   - `votes` (message_id, user_id, PK composite) — main-message upvotes only (enforced by trigger: parent_id must be null)
   - `reports` (id, message_id, reporter_id, reason enum, note, created_at, status)
   - Views: `message_stats` (upvotes, reply_count, score) for ranking
3. GRANTs + RLS on every table (read public for rooms/messages/profiles; insert/update scoped to `auth.uid()`; moderators via `has_role`).
4. Storage bucket `message-images` (public read, authenticated insert, 2MB limit).
5. Realtime publication on `messages` and `votes`.

## Phase 2 — Auth & shell
1. shadcn theme tokens in `src/styles.css` (deep red primary, neutral surfaces).
2. `/auth` page: email/password + Google OAuth (call `supabase--configure_social_auth` for google). Albanian copy.
3. `_authenticated` layout already managed — use for write actions only; browsing is public.
4. Root layout: mobile bottom nav + desktop sidebar shell. `onAuthStateChange` in `__root.tsx` (filtered).
5. Routes:
   - `/` → redirect to `/r/sheshi`
   - `/r/$slug` → room chat (public read)
   - `/r/$slug/t/$messageId` → thread view
   - `/fokus` → highlights tab (mobile)
   - `/profili` → profile (auth)
   - `/auth`, `/reset-password`

## Phase 3 — Chat, votes, highlights, moderation
1. Room chat: paginated message list (newest 50, load older), realtime subscribe scoped to current `room_id`, optimistic post via `createServerFn` + `useMutation`.
2. Message card: body, author, time, upvote button (one per user, debounced), reply count → opens thread.
3. Thread page: parent + replies list, reply composer.
4. Image upload: optional, via Supabase storage, server-validated MIME + size.
5. Në Fokus sidebar/sheet: three tabs (Hot / Top sot / Më të përgjigjura), server fn computes ranking with `(upvotes + replies*2) / pow(age_hours, 1.3)`.
6. Report dialog (reasons: spam, gjuhë urrejtjeje, doxxing, dhunë, tjetër).
7. Admin/mod panel at `/admin` (gated by `has_role`): list reports, soft-delete messages, ban users (set `profiles.banned_at`).

## Technical notes
- All server reads/writes via `createServerFn`. Public room/message reads use `supabaseAdmin` (imported inside handler) with explicit column projection; authenticated writes use `requireSupabaseAuth`.
- Vote insert is idempotent (PK conflict ignored).
- Ranking query uses the `message_stats` view for cheap reads.
- Input validation with Zod everywhere (body ≤ 2000 chars, no HTML).
- No DMs, no private rooms, no AI, no payments, no badges.
- Albanian UI strings centralized in `src/i18n/sq.ts`.

## Deliverable at end
Working app: sign in with Google or email, browse rooms, post messages, reply, upvote, see live updates and "Në Fokus" rankings, report messages, mods can act. Mobile bottom-nav UX + desktop 3-column.

Approve to proceed and I'll start with Phase 1 (Cloud + schema).
