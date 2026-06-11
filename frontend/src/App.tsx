import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, roomPath, setRefreshSession, threadPath } from "./api";
import {
  useAuthRouteModal,
  useBrowserRoute,
  useRealtimeRefresh,
  useThemePreference
} from "./appHooks";
import {
  authReturnKey,
  copyText,
  loadAuth,
  loadSavedIds,
  navigate,
  patchThread,
  saveAuth,
  savedKey
} from "./appSupport";
import type { AuthState, LoadState } from "./appSupport";
import { canAdmin, canModerate } from "./roles";
import type { AuthResponse, Message, Room, Thread } from "./types";
import { AdminModeBar, FocusPanel, MobileDigest, RoomRail, TopBar } from "./components/chrome";
import { CreateRoomDialog, Dialog, EmptyState, ShareDialog } from "./components/overlays";
import type { ShareTarget } from "./components/overlays";
import { AuthCallback, AuthPage } from "./views/Auth";
import { Home, RoomView, ThreadView } from "./views/feeds";
import { ModerationView } from "./views/Moderation";
import { Profile } from "./views/Profile";

async function loadHighlightGroups(token?: string | null) {
  return api.highlights({ mode: "focus", token });
}

async function loadOptionalPresence() {
  // Presence is side data; failed counts should not block rooms or feed rendering.
  return api.presence().catch((error) => {
    console.debug("presence unavailable", error);
    return {};
  });
}

export default function App() {
  const [route, setRoute] = useBrowserRoute();
  const [theme, setTheme] = useThemePreference();
  const [auth, setAuthState] = useState<AuthState>(() => loadAuth());
  const [roomsLoad, setRoomsLoad] = useState<LoadState<Room[]>>({ status: "loading", data: [] });
  const [highlights, setHighlights] = useState<Message[]>([]);
  const [presence, setPresence] = useState<Record<string, number>>({});
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authProviders, setAuthProviders] = useState<string[]>([]);
  const [authCallbackStatus, setAuthCallbackStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);

  const [roomMessagesLoad, setRoomMessagesLoad] = useState<LoadState<Message[]>>({ status: "idle", data: [] });
  const [roomCursor, setRoomCursor] = useState<string | null>(null);
  const [threadLoad, setThreadLoad] = useState<LoadState<Thread | null>>({ status: "idle", data: null });
  const [refreshTick, setRefreshTick] = useState(0);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => loadSavedIds());
  const refreshTimerRef = useRef<number | null>(null);

  const rooms = roomsLoad.data;
  const roomMessages = roomMessagesLoad.data;
  const thread = threadLoad.data;

  const currentRoom = useMemo(() => {
    if (route.name === "room") return rooms.find((room) => room.slug === route.slug) || null;
    if (thread) return rooms.find((room) => room.id === thread.root.room_id) || null;
    return null;
  }, [rooms, route, thread]);
  const canManageRooms = canAdmin(auth?.user);
  const canUseModeration = canModerate(auth?.user);
  const isAuthSurface = route.name === "authCallback";
  const isAdminWorkspace = route.name === "moderation";

  const setAuth = useCallback((next: AuthState) => {
    setAuthState(next);
    saveAuth(next);
  }, []);

  // Single-flight refresh: concurrent 401s share one rotation, and a failed
  // rotation (revoked/banned/expired) clears the session.
  const refreshInFlight = useRef<Promise<string | null> | null>(null);
  useEffect(() => {
    setRefreshSession(() => {
      refreshInFlight.current ??= (async () => {
        const current = loadAuth();
        if (!current?.refreshToken) return null;
        try {
          const result = await api.refresh({ refreshToken: current.refreshToken });
          setAuth({ token: result.access_token, refreshToken: result.refresh_token, user: result.user });
          return result.access_token;
        } catch {
          setAuth(null);
          return null;
        } finally {
          refreshInFlight.current = null;
        }
      })();
      return refreshInFlight.current;
    });
    return () => setRefreshSession(null);
  }, [setAuth]);

  const logout = useCallback(() => {
    const current = loadAuth();
    if (current?.token && current.refreshToken) {
      void api.logout({ token: current.token, refreshToken: current.refreshToken }).catch(() => undefined);
    }
    setAuth(null);
  }, [setAuth]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const openAuthModal = useCallback(() => {
    const returnPath = route.name === "auth" || route.name === "authCallback"
      ? "/"
      : `${window.location.pathname}${window.location.search}`;
    localStorage.setItem(authReturnKey, returnPath);
    setAuthOpen(true);
  }, [route.name]);

  useAuthRouteModal(route, setRoute, setAuthOpen);

  const loadRooms = useCallback(async () => {
    setRoomsLoad((current) => ({ status: "loading", data: current.data }));
    try {
      const [roomList, focusList, roomPresence] = await Promise.all([
        api.rooms(),
        loadHighlightGroups(auth?.token),
        loadOptionalPresence()
      ]);
      setRoomsLoad({ status: "ready", data: roomList });
      setHighlights(focusList);
      setPresence(roomPresence);
    } catch {
      setRoomsLoad((current) => ({
        status: "error",
        data: current.data,
        error: "Dhomat dhe postimet nuk u ngarkuan."
      }));
    }
  }, [auth?.token]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (refreshTick === 0) return;
    void loadRooms();
  }, [refreshTick, loadRooms]);

  useEffect(() => {
    if (!auth?.token) return;
    api.me({ token: auth.token }).then((user) => setAuth({ ...auth, user })).catch(() => setAuth(null));
  }, []);

  useEffect(() => {
    api.authProviders()
      .then(setAuthProviders)
      .catch((error) => {
        console.debug("auth providers unavailable", error);
        setAuthProviders([]);
      });
  }, []);

  const startExternalLogin = useCallback((provider: string) => {
    const returnPath = route.name === "authCallback"
      ? "/"
      : `${window.location.pathname}${window.location.search}`;
    localStorage.setItem(authReturnKey, returnPath);
    setAuthOpen(false);
    window.location.assign(api.externalAuthUrl({ provider }));
  }, [route.name]);

  useEffect(() => {
    if (route.name !== "authCallback") return;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) {
      setAuthCallbackStatus("failed");
      showToast("Hyrja me Google deshtoi.");
      return;
    }

    setAuthCallbackStatus("loading");
    api.me({ token: accessToken })
      .then((user) => {
        setAuth({ token: accessToken, refreshToken, user });
        window.history.replaceState({}, "", "/auth/callback");
        const next = localStorage.getItem(authReturnKey) || "/";
        localStorage.removeItem(authReturnKey);
        navigate(next);
      })
      .catch(() => {
        setAuthCallbackStatus("failed");
        showToast("Hyrja me Google deshtoi.");
      });
  }, [route.name, setAuth, showToast]);

  useEffect(() => {
    if (route.name !== "confirmEmail") return;

    const params = new URLSearchParams(window.location.search);
    const email = params.get("email");
    const token = params.get("token");
    navigate("/");
    if (!email || !token) {
      showToast("Linku i konfirmimit eshte i pavlefshem.");
      return;
    }

    api.confirmEmail({ email, token })
      .then(() => showToast("Email-i u konfirmua."))
      .catch(() => showToast("Konfirmimi i email-it deshtoi."));
  }, [route.name, showToast]);

  const loadRoomMessages = useCallback(async (roomId: string, cursor?: string | null, append = false) => {
    setRoomMessagesLoad((current) => ({ status: "loading", data: append ? current.data : [] }));
    try {
      const page = await api.messages({ roomId, cursor, token: auth?.token });
      setRoomMessagesLoad((current) => ({
        status: "ready",
        data: append ? [...current.data, ...page.items] : page.items
      }));
      setRoomCursor(page.next_cursor);
    } catch {
      setRoomMessagesLoad((current) => ({
        status: "error",
        data: current.data,
        error: "Temat nuk u ngarkuan."
      }));
    }
  }, [auth?.token]);

  useEffect(() => {
    if (!currentRoom || route.name !== "room") return;
    void loadRoomMessages(currentRoom.id);
  }, [currentRoom?.id, route.name, refreshTick, loadRoomMessages]);

  const loadThread = useCallback(async (id: string) => {
    setThreadLoad({ status: "loading", data: null });
    try {
      setThreadLoad({ status: "ready", data: await api.thread({ id, token: auth?.token }) });
    } catch (error) {
      const notFound = error instanceof ApiError && error.status === 404;
      setThreadLoad({
        status: "error",
        data: null,
        error: notFound ? "Tema nuk u gjet." : "Tema nuk u ngarkua.",
        notFound
      });
    }
  }, [auth?.token]);

  useEffect(() => {
    if (route.name !== "thread") {
      setThreadLoad({ status: "idle", data: null });
      return;
    }
    void loadThread(route.id);
  }, [route, refreshTick, loadThread]);

  useEffect(() => {
    // SignalR is the primary refresh signal; this slow poll only covers missed
    // events (dropped connections, backgrounded tabs).
    const interval = window.setInterval(() => {
      if (!document.hidden) setRefreshTick((tick) => tick + 1);
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  const onRealtimeChanged = useCallback(() => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      setRefreshTick((tick) => tick + 1);
    }, 250);
  }, []);

  useEffect(() => () => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
  }, []);

  const onPresence = useCallback((update: { roomId?: string; room_id?: string; count: number }) => {
    const roomId = update.roomId || update.room_id;
    if (!roomId) return;
    setPresence((current) => ({ ...current, [roomId]: update.count }));
  }, []);

  useRealtimeRefresh({
    route,
    rooms,
    currentRoomId: currentRoom?.id,
    threadId: route.name === "thread" ? thread?.root.id || route.id : null,
    token: auth?.token,
    onChanged: onRealtimeChanged,
    onPresence
  });

  async function handleAuth(response: Promise<AuthResponse>) {
    try {
      const result = await response;
      setAuth({ token: result.access_token, refreshToken: result.refresh_token, user: result.user });
      setAuthOpen(false);
      const next = localStorage.getItem(authReturnKey) || "/";
      localStorage.removeItem(authReturnKey);
      if (`${window.location.pathname}${window.location.search}` !== next) navigate(next);
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Hyrja deshtoi.");
    }
  }

  const requireAuth = useCallback(() => {
    if (auth) return true;
    openAuthModal();
    return false;
  }, [auth, openAuthModal]);

  const toggleSave = useCallback((message: Message) => {
    const next = new Set(savedIds);
    const saved = !next.has(message.id);
    if (saved) next.add(message.id);
    else next.delete(message.id);
    localStorage.setItem(savedKey, JSON.stringify([...next]));
    setSavedIds(next);
    showToast(saved ? "U ruajt." : "U hoq nga ruajtjet.");
  }, [savedIds, showToast]);

  const buildShareTarget = useCallback((message: Message): ShareTarget => {
    const room = rooms.find((item) => item.id === message.room_id);
    const url = `${window.location.origin}${threadPath(message.id)}`;
    const body = message.deleted_at ? "Ky mesazh eshte fshire." : message.body.trim();
    const excerpt = body.length > 160 ? `${body.slice(0, 157)}...` : body;
    return {
      title: `${room?.name || "Sheshi"} ne Sheshi`,
      text: excerpt || "Diskutim ne Sheshi",
      url,
      roomName: room?.name || null
    };
  }, [rooms]);

  const copyShareTarget = useCallback(async (target: ShareTarget) => {
    try {
      const copied = await copyText(target.url);
      showToast(copied ? "Linku u kopjua." : "Linku nuk u kopjua.");
      if (copied) setShareTarget(null);
    } catch {
      showToast("Linku nuk u kopjua.");
    }
  }, [showToast]);

  const shareMessage = useCallback(async (message: Message) => {
    const target = buildShareTarget(message);
    if (navigator.share) {
      try {
        await navigator.share({ title: target.title, text: target.text, url: target.url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    setShareTarget(target);
  }, [buildShareTarget]);

  const upvote = useCallback(async (message: Message, patch: (message: Message) => void) => {
    if (!auth?.token) {
      openAuthModal();
      return;
    }

    const next = {
      ...message,
      voted: !message.voted,
      upvotes: message.upvotes + (message.voted ? -1 : 1)
    };
    patch(next);

    try {
      if (message.voted) await api.removeUpvote({ token: auth.token, id: message.id });
      else await api.upvote({ token: auth.token, id: message.id });
    } catch {
      patch(message);
      showToast("Vota nuk u ruajt.");
    }
  }, [auth?.token, openAuthModal, showToast]);

  function patchMessage(next: Message) {
    setRoomMessagesLoad((current) => ({
      ...current,
      data: current.data.map((message) => message.id === next.id ? next : message)
    }));
    setHighlights((messages) => messages.map((message) => message.id === next.id ? next : message));
    setThreadLoad((current) => ({
      ...current,
      data: current.data ? patchThread(current.data, next) : current.data
    }));
  }

  async function submitMessage(roomId: string, body: string, parentId?: string | null) {
    if (!auth?.token) {
      openAuthModal();
      return false;
    }
    try {
      const created = await api.postMessage({
        token: auth.token,
        input: { room_id: roomId, parent_id: parentId, body }
      });
      if (parentId) await loadThread(created.root_message_id);
      else await loadRoomMessages(roomId);
      await loadRooms();
      return true;
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Mesazhi nuk u dergua.");
      return false;
    }
  }

  return (
    <div className={`app ${canManageRooms ? "admin-session" : ""}`}>
      <TopBar
        theme={theme}
        setTheme={setTheme}
        auth={auth}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onAuth={openAuthModal}
        hideAuthAction={isAuthSurface || authOpen}
        canCreateRooms={canManageRooms}
        canModerate={canUseModeration && !canManageRooms}
        onCreate={() => canManageRooms ? setCreateRoomOpen(true) : openAuthModal()}
        onLogout={logout}
      />

      {canManageRooms && !isAuthSurface && (
        <AdminModeBar
          label={auth?.user.display_name || auth?.user.username || auth?.user.email || "admin"}
          roomsCount={rooms.length}
          onCreate={() => setCreateRoomOpen(true)}
        />
      )}

      <div className={`layout ${route.name === "home" ? "front-layout" : ""} ${isAuthSurface ? "auth-layout" : ""} ${isAdminWorkspace ? "admin-layout" : ""}`}>
        {!isAuthSurface && !isAdminWorkspace && (
          <RoomRail
            rooms={rooms}
            activeRoom={currentRoom}
            canCreateRooms={canManageRooms}
            onCreate={() => canManageRooms ? setCreateRoomOpen(true) : openAuthModal()}
          />
        )}

        {route.name !== "home" && !isAuthSurface && !isAdminWorkspace && <MobileDigest highlights={highlights} rooms={rooms} />}

        <main className="main">
          {route.name === "home" && (
            <Home
              rooms={rooms}
              highlights={highlights}
              searchQuery={searchQuery}
              loadStatus={roomsLoad.status}
              loadError={roomsLoad.error}
              onRetry={loadRooms}
              canCreateRooms={canManageRooms}
              onCreate={() => canManageRooms ? setCreateRoomOpen(true) : openAuthModal()}
              onVote={(message) => upvote(message, patchMessage)}
              onSave={toggleSave}
              onShare={shareMessage}
              savedIds={savedIds}
              requireAuth={requireAuth}
            />
          )}
          {route.name === "room" && currentRoom && (
            <RoomView
              room={currentRoom}
              messages={roomMessages}
              loadStatus={roomMessagesLoad.status}
              loadError={roomMessagesLoad.error}
              cursor={roomCursor}
              onRetry={() => loadRoomMessages(currentRoom.id)}
              onMore={() => loadRoomMessages(currentRoom.id, roomCursor, true)}
              onSubmit={(body) => submitMessage(currentRoom.id, body)}
              onVote={(message) => upvote(message, patchMessage)}
              onSave={toggleSave}
              onShare={shareMessage}
              savedIds={savedIds}
              requireAuth={requireAuth}
              canCreateThreads={canManageRooms}
            />
          )}
          {route.name === "room" && !currentRoom && <EmptyState title="Dhoma nuk u gjet" action="Kthehu te dhomat" onAction={() => navigate("/")} />}
          {route.name === "thread" && (
            <ThreadView
              thread={thread}
              selectedId={route.id}
              loadStatus={threadLoad.status}
              loadError={threadLoad.error}
              notFound={threadLoad.notFound}
              rooms={rooms}
              onRetry={() => loadThread(route.id)}
              onSubmit={submitMessage}
              onVote={(message) => upvote(message, patchMessage)}
              onSave={toggleSave}
              onShare={shareMessage}
              savedIds={savedIds}
              requireAuth={requireAuth}
            />
          )}
          {route.name === "authCallback" && (
            <AuthCallback
              status={authCallbackStatus}
              onAuth={() => {
                localStorage.setItem(authReturnKey, "/");
                setAuthOpen(true);
                navigate("/");
              }}
            />
          )}
          {route.name === "profile" && (
            <Profile
              auth={auth}
              canModerate={canUseModeration}
              canCreateRooms={canManageRooms}
              onAuth={openAuthModal}
              onCreate={() => canManageRooms ? setCreateRoomOpen(true) : openAuthModal()}
              onLogout={logout}
            />
          )}
          {route.name === "moderation" && (
            <ModerationView
              auth={auth}
              canModerate={canUseModeration}
              canAdmin={canManageRooms}
              onAuth={openAuthModal}
              onError={showToast}
            />
          )}
        </main>

        {!isAuthSurface && !isAdminWorkspace && (
          <FocusPanel highlights={highlights} rooms={rooms} />
        )}
      </div>

      {authOpen && (
        <Dialog title="HYR NE SHESHI" onClose={() => setAuthOpen(false)}>
          <AuthPage
            providers={authProviders}
            onExternal={startExternalLogin}
            onLogin={(email, password) => handleAuth(api.login({ email, password }))}
            onRegister={(email, password, displayName) => handleAuth(api.register({ email, password, displayName }))}
          />
        </Dialog>
      )}

      {createRoomOpen && auth?.token && (
        <CreateRoomDialog
          token={auth.token}
          onClose={() => setCreateRoomOpen(false)}
          onCreated={(room) => {
            setCreateRoomOpen(false);
            void loadRooms();
            navigate(roomPath(room.slug));
          }}
          onError={showToast}
        />
      )}

      {shareTarget && (
        <ShareDialog
          target={shareTarget}
          onClose={() => setShareTarget(null)}
          onCopy={(target) => void copyShareTarget(target)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
