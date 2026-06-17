import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { getRoomBySlug, listMessages } from "@/api";
import { PostCard } from "@/components/PostCard";
import { DockedComposer } from "@/components/DockedComposer";
import { ErrorState } from "@/components/ErrorState";
import { FeedSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/useAuth";
import { useDockOffset } from "@/useDockOffset";
import { type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { MessageRow, Room } from "@/types";

// The one room stream, used identically by the Sheshi tab and every #dhomë room: chat-ordered
// (newest at the bottom) with the shared docked composer that floats above the persistent dock.
export function RoomFeed({ slug }: { slug: string }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const offset = useDockOffset();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Distinct from an empty room: the room/messages fetch rejected (5xx / network), so we show a
  // retry instead of a blank stream.
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const loadingMore = useRef(false);

  const reload = useCallback(async (roomId: string) => {
    const page = await listMessages(roomId);
    setMessages(page.items);
    setCursor(page.next_cursor);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const r = await getRoomBySlug(slug);
        if (!alive) return;
        setRoom(r);
        if (r) await reload(r.id);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, reload, reloadKey]);

  const onRefresh = useCallback(async () => {
    if (!room) return;
    setRefreshing(true);
    try {
      await reload(room.id);
    } finally {
      setRefreshing(false);
    }
  }, [room, reload]);

  const loadMore = useCallback(async () => {
    if (!room || !cursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await listMessages(room.id, cursor);
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...page.items.filter((m) => !seen.has(m.id))];
      });
      setCursor(page.next_cursor);
    } finally {
      loadingMore.current = false;
    }
  }, [room, cursor]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      {loading ? (
        <FeedSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
      ) : (
        <FlatList
          data={messages}
          // Chat order (newest at the bottom): data stays newest-first; `inverted` renders index 0
          // at the bottom and turns onEndReached into "load older" at the top. [feed mode = drop `inverted`]
          inverted
          keyExtractor={(m) => m.id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingTop: 8 }}
          renderItem={({ item }) => (
            <PostCard message={item} compact currentUserId={user?.id ?? null} onPress={() => router.push(`/tema/${item.id}`)} />
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textMuted} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={cursor ? <ActivityIndicator color={theme.textFaint} style={{ margin: 16 }} /> : null}
        />
      )}
      {room && user ? (
        <DockedComposer
          roomId={room.id}
          placeholder={`Shkruaj në ${room.name}…`}
          onPosted={(m) => setMessages((prev) => [m, ...prev])}
        />
      ) : room ? (
        <Pressable onPress={() => router.push("/auth")} style={[styles.signInBar, { paddingBottom: 16 + offset }]}>
          <Text style={styles.signInText}>Hyr për të postuar në {room.name}</Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: 62 },
    signInBar: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
      paddingHorizontal: 16,
      paddingTop: 16,
      alignItems: "center",
      backgroundColor: t.bg,
    },
    signInText: { color: t.primary, fontWeight: "700" },
  });
}
