# Sheshi — Mobile (React Native / Expo)

A modern, iPhone-native, Reddit-style mobile client for Sheshi. Talks to the same
`Sheshi.Api` backend (votes, threads, auth) as the web app.

## Run

```bash
cd mobile
npm install
npx expo start        # press i for the iOS simulator, or scan the QR with Expo Go
```

The API base URL is in `app.json` → `expo.extra.apiBase` (default `http://localhost:5080`).

- **iOS simulator** reaches your machine as `localhost`, so the default works.
- **Physical device (Expo Go)**: set `apiBase` to your computer's LAN IP, e.g.
  `http://192.168.1.20:5080`, and make sure the API binds to `0.0.0.0` / your LAN.

Sign in with a seeded account (e.g. `admin@sheshi.al` / `Admin1234!`).

## What's here

- `app/(tabs)/` — the bottom-dock tabs: `index` (the #sheshi feed), `fokus`
  (Në Fokus highlights), `dhoma` (room switcher). `(tabs)/_layout` defines the
  iPhone-native **liquid-glass dock** (expo-blur, Ionicons, red active tint).
- `app/dhoma/[slug]` — any room opened from the Dhoma tab (shares `RoomFeed`).
- `app/tema/[id]` — a thread; `app/auth` — the login modal.
- `src/api.ts` — fetch client with AsyncStorage token storage + refresh-on-401/403.
- `src/theme.ts` — light + dark palettes (Albanian red, indigo downvote).
- `src/useTheme.tsx` — `ThemeProvider` + `useTheme()`: active palette resolves to
  (persisted override ?? system scheme). Components read it via `makeStyles(theme)`.
- `src/components/` — `RoomFeed` (the reusable per-room feed), `VoteControl`
  (▲ score ▼, optimistic + haptics + spring pop), `PostCard`, `Composer`,
  `AuthButton`, `ThemeToggle` (sun/moon), `PressableScale` (springy press feel).

## Features

- **Light & dark themes** — follows the system by default; the sun/moon header
  toggle pins a choice and persists it (AsyncStorage).
- Bottom-dock navigation: **Sheshi** (feed), **Fokus** (highlights), **Dhoma** (rooms),
  with an iOS-style frosted/translucent dock the feed scrolls under.
- Read the live feed (pull-to-refresh + infinite scroll), open any post into its thread.
- Në Fokus highlights with hot / top-today / most-replied ranking.
- Switch rooms from the Dhoma tab; each opens its own feed.
- Up/down voting with optimistic UI, haptic feedback, and a spring pop.
- Threaded comments with indentation; reply to the thread or to a specific comment.
- Email/password auth with automatic token refresh.

Reading is open; voting and posting prompt sign-in.
