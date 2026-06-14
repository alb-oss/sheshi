// Sheshi mobile — light + dark palettes. Reddit-style, Albanian-red brand, indigo downvote.
// Components never import a fixed palette; they read the active one from useTheme() so light
// mode is a real per-render swap (see src/useTheme.tsx).

export type Palette = {
  bg: string;
  card: string;
  card2: string;
  border: string;
  threadLine: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string; // up / brand
  downvote: string;
  onPrimary: string;
  upTint: string; // soft background behind an active upvote pill
  downTint: string; // soft background behind an active downvote pill
  glass: string; // translucent fill layered under the blurred dock/header
  glassBorder: string; // hairline on glass surfaces
  blurTint: "light" | "dark"; // expo-blur BlurView tint
};

export const palettes: { light: Palette; dark: Palette } = {
  dark: {
    bg: "#0b0c0f",
    card: "#15171c",
    card2: "#1d2026",
    border: "rgba(255,255,255,0.09)",
    threadLine: "rgba(255,255,255,0.16)",
    text: "#e9eaed",
    textMuted: "#8f949e",
    textFaint: "#6a6e78",
    primary: "#f5333f",
    downvote: "#6e8bff",
    onPrimary: "#ffffff",
    upTint: "rgba(245,51,63,0.14)",
    downTint: "rgba(110,139,255,0.14)",
    glass: "rgba(13,14,18,0.62)",
    glassBorder: "rgba(255,255,255,0.08)",
    blurTint: "dark",
  },
  light: {
    bg: "#f4f5f7",
    card: "#ffffff",
    card2: "#eceef2",
    border: "rgba(0,0,0,0.10)",
    threadLine: "rgba(0,0,0,0.13)",
    text: "#14161a",
    textMuted: "#5c626d",
    textFaint: "#9aa0ab",
    primary: "#e11d2a",
    downvote: "#3f57d6",
    onPrimary: "#ffffff",
    upTint: "rgba(225,29,42,0.10)",
    downTint: "rgba(63,87,214,0.10)",
    glass: "rgba(244,245,247,0.62)",
    glassBorder: "rgba(0,0,0,0.07)",
    blurTint: "light",
  },
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export type ThemeMode = "light" | "dark";
