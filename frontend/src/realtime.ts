import { HubConnectionBuilder, HubConnectionState, LogLevel } from "@microsoft/signalr";
import { apiBase } from "./api";

export type RealtimePresenceUpdate = { room_id: string; count: number };

export type RealtimeMessageChange = {
  type: string;
  room_id: string;
  thread_id: string | null;
  message_id: string | null;
};

type RealtimeCallbacks = {
  token?: string | null;
  onMessage: (change: RealtimeMessageChange) => void;
  onPresence: (update: RealtimePresenceUpdate) => void;
};

type RealtimeScope = RealtimeCallbacks & {
  roomIds?: string[];
  threadId?: string | null;
};

const hubEvents = {
  messageChanged: "message_changed",
  presence: "presence"
} as const;

const hubMethods = {
  joinRoom: "JoinRoom",
  leaveRoom: "LeaveRoom",
  joinThread: "JoinThread",
  leaveThread: "LeaveThread"
} as const;

export function subscribeToRooms(args: RealtimeCallbacks & { roomIds: string[] }) {
  return subscribeToRealtime({ ...args, roomIds: args.roomIds });
}

export function subscribeToThread(args: RealtimeCallbacks & { roomId?: string | null; roomIds?: string[]; threadId: string }) {
  return subscribeToRealtime({
    ...args,
    roomIds: [...(args.roomIds ?? []), ...(args.roomId ? [args.roomId] : [])],
    threadId: args.threadId
  });
}

function subscribeToRealtime(args: RealtimeScope) {
  const roomIds = uniqueIds(args.roomIds ?? []);
  const threadId = args.threadId || null;
  if (roomIds.length === 0 && !threadId) return () => undefined;

  let disposed = false;
  const connection = new HubConnectionBuilder()
    .withUrl(`${apiBase}/hub`, args.token ? { accessTokenFactory: () => args.token || "" } : {})
    .configureLogging(LogLevel.None)
    .withAutomaticReconnect()
    .build();

  connection.on(hubEvents.messageChanged, args.onMessage);
  connection.on(hubEvents.presence, args.onPresence);

  const started = connection.start()
    .then(async () => {
      if (disposed) return;
      await Promise.all(roomIds.map((roomId) => connection.invoke(hubMethods.joinRoom, roomId).catch(() => undefined)));
      if (threadId) await connection.invoke(hubMethods.joinThread, threadId).catch(() => undefined);
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    connection.off(hubEvents.messageChanged, args.onMessage);
    connection.off(hubEvents.presence, args.onPresence);

    void started
      .then(async () => {
        if (connection.state !== HubConnectionState.Connected) return;
        await Promise.all(roomIds.map((roomId) => connection.invoke(hubMethods.leaveRoom, roomId).catch(() => undefined)));
        if (threadId) await connection.invoke(hubMethods.leaveThread, threadId).catch(() => undefined);
      })
      .finally(() => {
        void connection.stop();
      });
  };
}

function uniqueIds(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
