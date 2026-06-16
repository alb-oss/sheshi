import { HubConnection, HubConnectionBuilder, HubConnectionState } from "@microsoft/signalr";
import { getApiBaseUrl } from "@/lib/api-client";
import { getAccessToken, subscribeTokenStore } from "@/lib/token-store";

let connection: HubConnection | null = null;
let startPromise: Promise<HubConnection> | null = null;
// The user identity (JWT `sub`) the current connection handshook as. The hub handshake captures the
// token ONCE at connect time, so a connection opened anonymously (e.g. before a boot session-restore
// finished) stays anonymous — and never receives per-user pushes (Clients.User, e.g. the my_vote
// colour sync). When the identity changes we tear the connection down so it re-handshakes with the
// new token.
let connectedSub: string | null = null;

const CONNECT_WAIT_MS = 5_000;

function tokenSub(token: string | null): string | null {
  if (!token) return null;
  try {
    return (JSON.parse(atob(token.split(".")[1])) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

async function resetRealtimeConnection() {
  const old = connection;
  connection = null;
  startPromise = null;
  connectedSub = tokenSub(getAccessToken());
  if (old) {
    try {
      await old.stop();
    } catch {
      // discarding it anyway
    }
  }
}

// Reconnect when the signed-in identity changes (login / logout / boot session-restore). Same-user
// token refresh (same sub) is ignored to avoid needless churn. The route effects (keyed on userId)
// re-run on the same change and re-register handlers + re-join groups on the fresh connection.
if (typeof window !== "undefined") {
  subscribeTokenStore(() => {
    if (tokenSub(getAccessToken()) !== connectedSub) void resetRealtimeConnection();
  });
}

// The groups this client is currently subscribed to (JoinRoom/JoinThread/JoinModeration). A reconnect
// is a brand-new server-side connection with NO group memberships, so we must re-join everything or
// realtime goes silently dead (connected, but receiving nothing) until the next navigation.
const activeGroups = new Map<string, { method: string; args: unknown[] }>();

function groupKey(method: string, args: unknown[]) {
  return args.length ? `${method}:${String(args[0])}` : method;
}

// Listeners fired after a reconnect, once groups have been re-joined. Views use this to refetch their
// source-of-truth queries: realtime deltas are fire-and-forget, so any event missed while the socket
// was down (a backgrounded phone, a network blip) is gone — re-syncing on reconnect makes the client
// re-converge instead of silently drifting from other devices.
const reconnectedListeners = new Set<() => void>();

export function onRealtimeReconnected(listener: () => void) {
  reconnectedListeners.add(listener);
  return () => {
    reconnectedListeners.delete(listener);
  };
}

export function ensureRealtimeConnection() {
  if (connection) return connection;

  connection = new HubConnectionBuilder()
    .withUrl(getApiBaseUrl() + "/hub", {
      accessTokenFactory: () => getAccessToken() ?? "",
    })
    .withAutomaticReconnect()
    .build();

  // Replay group memberships after an automatic reconnect (new connection id → empty groups), then
  // tell views to re-sync so they catch up on any deltas missed while the socket was down.
  connection.onreconnected(() => {
    connectedSub = tokenSub(getAccessToken());
    for (const { method, args } of activeGroups.values())
      void connection?.invoke(method, ...args).catch(() => {});
    for (const listener of reconnectedListeners) listener();
  });

  return connection;
}

export async function ensureRealtimeStarted() {
  const conn = ensureRealtimeConnection();
  if (conn.state === HubConnectionState.Connected) return conn;
  if (conn.state === HubConnectionState.Disconnected) {
    if (!startPromise) {
      startPromise = conn
        .start()
        .then(() => {
          connectedSub = tokenSub(getAccessToken());
          return conn;
        })
        .finally(() => {
          startPromise = null;
        });
    }
    return startPromise;
  }
  if (startPromise) return startPromise;
  await waitForConnected(conn);
  return conn;
}

export async function invokeRealtime(methodName: string, ...args: unknown[]) {
  try {
    const conn = await ensureRealtimeStarted();
    if (conn.state !== HubConnectionState.Connected) return false;
    await conn.invoke(methodName, ...args);
    // Track group membership so onreconnected can replay it. Leave* untracks its matching Join*.
    if (methodName.startsWith("Join"))
      activeGroups.set(groupKey(methodName, args), { method: methodName, args });
    else if (methodName.startsWith("Leave"))
      activeGroups.delete(groupKey("Join" + methodName.slice("Leave".length), args));
    return true;
  } catch {
    return false;
  }
}

function waitForConnected(conn: HubConnection) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (conn.state === HubConnectionState.Connected) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (
        conn.state === HubConnectionState.Disconnected ||
        Date.now() - startedAt > CONNECT_WAIT_MS
      ) {
        clearInterval(interval);
        reject(new Error("REALTIME_NOT_CONNECTED"));
      }
    }, 50);
  });
}
