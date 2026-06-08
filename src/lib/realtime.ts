import { HubConnection, HubConnectionBuilder, HubConnectionState } from "@microsoft/signalr";
import { getApiBaseUrl } from "@/lib/api-client";
import { getStoredTokens } from "@/lib/token-store";

let connection: HubConnection | null = null;

export function getRealtimeConnection() {
  if (connection) return connection;

  connection = new HubConnectionBuilder()
    .withUrl(getApiBaseUrl() + "/hub", {
      accessTokenFactory: () => getStoredTokens()?.accessToken ?? "",
    })
    .withAutomaticReconnect()
    .build();

  return connection;
}

export async function ensureRealtimeStarted() {
  const conn = getRealtimeConnection();
  if (conn.state === HubConnectionState.Disconnected) await conn.start();
  return conn;
}
