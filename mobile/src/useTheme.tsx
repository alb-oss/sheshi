// Theme context: resolves the active palette as (user override ?? system scheme), persists the
// override, and exposes a binary toggle that mirrors the web app's sun/moon switch.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { palettes, type Palette, type ThemeMode } from "./theme";

const STORAGE_KEY = "sheshi.theme";

type ThemeContextValue = {
  theme: Palette;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme(); // "light" | "dark" | null
  const [override, setOverride] = useState<ThemeMode | null>(null);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (alive && (v === "light" || v === "dark")) setOverride(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const mode: ThemeMode = override ?? (system === "light" ? "light" : "dark");

  const setMode = useCallback((next: ThemeMode) => {
    setOverride(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: palettes[mode], mode, setMode, toggle }),
    [mode, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
