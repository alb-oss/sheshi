import { HubConnection, HubConnectionBuilder, HubConnectionState } from "@microsoft/signalr";
import { getApiBaseUrl } from "@/lib/api-client";
import { getAccessToken } from "@/lib/token-store";

let connection: HubConnection | null = null;
let startPromise: Promise<HubConnection> | null = null;

const CONNECT_WAIT_MS = 5_000;

export function ensureRealtimeConnection() {
  if (connection) return connection;

  connection = new HubConnectionBuilder()
    .withUrl(getApiBaseUrl() + "/hub", {
      accessTokenFactory: () => getAccessToken() ?? "",
    })
    .withAutomaticReconnect()
    .build();

  return connection;
}

export async function ensureRealtimeStarted() {
  const conn = ensureRealtimeConnection();
  if (conn.state === HubConnectionState.Connected) return conn;
  if (conn.state === HubConnectionState.Disconnected) {
    if (!startPromise) {
      startPromise = conn.start().then(() => conn).finally(() => {
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
