# Mobile: light/dark theming, liquid-glass dock, and a smoothness pass

Date: 2026-06-14
Scope: `mobile/` (React Native / Expo) only. No API or web changes.

## Goals (from the request)

1. **Light mode** — the app is dark-only today; add a light palette and let users switch.
2. **Smoother, better frontend** — micro-interactions, press feedback, spacing/typography pass.
3. **iPhone-like dock with "liquid glass"** — a translucent, frosted bottom tab bar that
   content scrolls *under*, exactly like the iOS system tab bar.
4. **Re-analyzed end to end** — every screen verified in both themes.

## Current state (analysis)

- `src/theme.ts` exports a single static `theme` object (dark only) + `radius`.
- **Every** component and screen does two things that block theming:
  - imports the static `theme` for inline colors, and
  - bakes `theme` into a module-level `StyleSheet.create(...)` (evaluated once at import).
- Files touching `theme`: `components/{PostCard,VoteControl,Composer,AuthButton,RoomFeed}`,
  screens `app/(tabs)/{_layout,index,fokus,dhoma}`, `app/dhoma/[slug]`, `app/tema/[id]`,
  `app/auth`, and `app/_layout`.
- The dock is a stock `expo-router` `Tabs` with a solid `theme.bg` bar.
- `app.json` forces `userInterfaceStyle: "dark"`.

The static `StyleSheet.create` is the crux: light mode is impossible until styles are produced
*per render* from the active palette.

## Design

### 1. Palettes (`src/theme.ts`)
Replace the single `theme` with a typed `Palette` and `palettes = { light, dark }`. The shape
gains keys the components currently hardcode inline so nothing stays theme-blind:
`upTint` / `downTint` (the soft vote-pill backgrounds, today hardcoded rgba of the dark red),
`glassBorder` (dock hairline), and `blurTint` (`"light" | "dark"` for `BlurView`).
Light keeps the Albanian-red brand but deepens it slightly (`#e11d2a`) for contrast on white;
downvote indigo deepens to `#3f57d6`.

### 2. Theme provider (`src/useTheme.tsx`)
- `ThemeProvider` resolves the active mode as `override ?? systemScheme` where `systemScheme`
  comes from RN `useColorScheme()` and `override` is a persisted user choice (`AsyncStorage`,
  key `sheshi.theme`).
- `useTheme()` → `{ theme, mode, toggle, setMode }`. `toggle` flips light↔dark and persists,
  matching the web app's binary sun/moon toggle (no tri-state "auto" for parity + simplicity).
- Default (no stored choice) = follow the system. First user toggle pins an explicit choice.

### 3. Component refactor (mechanical, every file)
Pattern, applied uniformly:
```ts
const { theme } = useTheme();
const s = useMemo(() => makeStyles(theme), [theme]);
// inline colors read `theme.*` from the hook
function makeStyles(t: Palette) { return StyleSheet.create({ /* uses t.* */ }); }
```
`radius` stays a static import (theme-independent).

### 4. Liquid-glass dock (`app/(tabs)/_layout.tsx`)
- `tabBarBackground: () => <BlurView tint={theme.blurTint} intensity=… style={StyleSheet.absoluteFill} />`.
- `tabBarStyle: { position: "absolute", backgroundColor: "transparent", borderTopColor: theme.glassBorder,
  height: 49 + insets.bottom, paddingBottom: insets.bottom }` — absolute so the feed scrolls under it.
- Active tint = brand red; inactive = `textMuted`; haptic on `tabPress`.
- Because the bar is absolute, the three tab lists (`index`/`fokus`/`dhoma`) get
  `contentContainerStyle.paddingBottom = dockHeight` so nothing is trapped under the glass.

### 5. The composer-vs-dock collision
Only the **Sheshi** tab has a docked `Composer`, and an absolute dock would cover it.
Resolution: `RoomFeed` gains a `dockOffset` prop.
- `(tabs)/index` passes `dockOffset = 49 + insets.bottom`; the composer floats just above the glass.
- `dhoma/[slug]` and `tema/[id]` are full-screen **Stack** screens with no dock → `dockOffset = 0`,
  composer sits at the very bottom as today.
- A tiny `useKeyboardVisible()` (RN `Keyboard` events) zeroes the offset while typing, and the dock
  uses `tabBarHideOnKeyboard` — so focusing the input drops the composer cleanly to the keyboard.
  (On web there is no soft keyboard, so the composer simply floats above the dock.)

### 6. Smoothness pass
- `PressableScale` — a reusable wrapper animating `scale` (RN `Animated`, native driver) on
  press-in/out; used by feed rows, room cards, Fokus rows, and primary buttons.
- `VoteControl` — a spring "pop" on the tapped arrow + animated tint; keeps optimistic + haptics.
- `ThemeToggle` — sun/moon Ionicon in the tabs `headerLeft`.
- Header + status bar follow the theme; root background follows the theme (no flash).
- Spacing/typography tightened for rhythm; no new icon set beyond the Ionicons already added.

No `react-native-reanimated` — built-in `Animated` keeps it web-safe and avoids a native rebuild.
Only new dependency: `expo-blur` (~14.0.3, ships a web build).

## Verification
Run on Expo Web (390×844) and screenshot **both themes** for: Sheshi feed + glass dock, Fokus,
Dhoma, a thread, and the auth modal; confirm the dock blurs content scrolling under it and the
toggle flips every surface. 0 console errors (modulo the expected session 401→refresh).

## Commits (atomic)
1. `feat(mobile): theme system — light + dark palettes, ThemeProvider, persisted toggle`
2. `feat(mobile): liquid-glass tab dock (expo-blur) + content scrolls under`
3. `feat(mobile): smoothness pass — press-scale, vote pop, themed headers/status bar`
4. `docs(mobile): sync README with theming + glass dock`
```
