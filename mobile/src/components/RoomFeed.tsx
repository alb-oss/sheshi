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
import { Composer } from "@/components/Composer";
import { FeedSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/useAuth";
import { useKeyboardVisible } from "@/useKeyboardVisible";
import { type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { MessageRow, Room } from "@/types";

// `dockOffset` lifts the docked composer above the absolute glass tab bar on tabs that show it
// (the Sheshi tab). Full-screen Stack rooms pass 0. While the keyboard is up the offset collapses
// so the composer meets the keyboard cleanly (and the dock hides itself).
export function RoomFeed({ slug, dockOffset = 0 }: { slug: string; dockOffset?: number }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const keyboardUp = useKeyboardVisible();
  const offset = keyboardUp ? 0 : dockOffset;
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadingMore = useRef(false);

  const reload = useCallback(async (roomId: string) => {
    const page = await listMessages(roomId);
    setMessages(page.items);
    setCursor(page.next_cursor);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const r = await getRoomBySlug(slug);
        if (!alive) return;
        setRoom(r);
        if (r) await reload(r.id);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, reload]);

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
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: 8 }}
          renderItem={({ item }) => (
            <PostCard message={item} compact onPress={() => router.push(`/tema/${item.id}`)} />
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
        <View style={{ paddingBottom: offset }}>
          <Composer
            roomId={room.id}
            placeholder={`Shkruaj në ${room.name}…`}
            onPosted={(m) => setMessages((prev) => [m, ...prev])}
          />
        </View>
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
