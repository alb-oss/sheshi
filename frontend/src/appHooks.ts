import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  authReturnKey,
  parseRoute,
  themeKey
} from "./appSupport";
import type { PresenceUpdate, Route, Theme } from "./appSupport";
import { subscribeToRooms, subscribeToThread } from "./realtime";
import type { Room } from "./types";

export function useBrowserRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    const onRoute = () => setRoute(parseRoute());
    window.addEventListener("popstate", onRoute);
    return () => window.removeEventListener("popstate", onRoute);
  }, []);

  return [route, setRoute] as const;
}

export function useThemePreference() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(themeKey) as Theme) || "dark");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  return [theme, setTheme] as const;
}

export function useAuthRouteModal(
  route: Route,
  setRoute: Dispatch<SetStateAction<Route>>,
  setAuthOpen: Dispatch<SetStateAction<boolean>>
) {
  useEffect(() => {
    if (route.name !== "auth") return;
    localStorage.setItem(authReturnKey, "/");
    window.history.replaceState({}, "", "/");
    setRoute({ name: "home" });
    setAuthOpen(true);
  }, [route.name, setRoute, setAuthOpen]);
}

export function useRealtimeRefresh(args: {
  route: Route;
  rooms: Room[];
  currentRoomId?: string | null;
  threadId?: string | null;
  token?: string | null;
  onChanged: () => void;
  onPresence: (update: PresenceUpdate) => void;
}) {
  const { route, rooms, currentRoomId, threadId, token, onChanged, onPresence } = args;
  const roomScopeKey = useMemo(() => rooms.map((room) => room.id).sort().join("|"), [rooms]);

  useEffect(() => {
    const roomIds = roomScopeKey ? roomScopeKey.split("|") : currentRoomId ? [currentRoomId] : [];
    if (roomIds.length === 0 && !threadId) return;

    if (threadId) {
      return subscribeToThread({
        roomIds,
        threadId,
        token,
        onChanged,
        onPresence
      });
    }

    return subscribeToRooms({
      roomIds,
      token,
      onChanged,
      onPresence
    });
  }, [currentRoomId, onChanged, onPresence, roomScopeKey, threadId, token]);
}
