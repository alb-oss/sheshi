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

- `app/` — Expo Router screens: `index` (the #sheshi feed), `tema/[id]` (a thread),
  `auth` (login modal).
- `src/api.ts` — fetch client with AsyncStorage token storage + refresh-on-401/403.
- `src/components/` — `VoteControl` (▲ score ▼, optimistic + haptics), `PostCard`,
  `Composer`.
- `src/theme.ts` — the Reddit-style dark palette (Albanian red, indigo downvote).

## Features

- Read the live feed (pull-to-refresh + infinite scroll), open any post into its thread.
- Up/down voting with optimistic UI and haptic feedback.
- Threaded comments with indentation; reply to the thread or to a specific comment.
- Email/password auth with automatic token refresh.

Reading is open; voting and posting prompt sign-in.
