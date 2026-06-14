import { useCallback, useEffect, useRef, useState } from "react";
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
import { Stack, router } from "expo-router";
import { getRoomBySlug, listMessages, logout } from "@/api";
import { PostCard } from "@/components/PostCard";
import { Composer } from "@/components/Composer";
import { useAuth } from "@/useAuth";
import { theme } from "@/theme";
import type { MessageRow, Room } from "@/types";

export default function Feed() {
  const { user } = useAuth();
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
    (async () => {
      try {
        const r = await getRoomBySlug("sheshi");
        setRoom(r);
        if (r) await reload(r.id);
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

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
      <Stack.Screen
        options={{
          headerRight: () =>
            user ? (
              <Pressable hitSlop={8} onPress={() => logout()}>
                <Text style={styles.headerBtn}>Dil</Text>
              </Pressable>
            ) : (
              <Pressable hitSlop={8} onPress={() => router.push("/auth")}>
                <Text style={[styles.headerBtn, { color: theme.primary }]}>Hyr</Text>
              </Pressable>
            ),
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentInsetAdjustmentBehavior="automatic"
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
        <Composer roomId={room.id} onPosted={(m) => setMessages((prev) => [m, ...prev])} />
      ) : room ? (
        <Pressable onPress={() => router.push("/auth")} style={styles.signInBar}>
          <Text style={styles.signInText}>Hyr për të postuar në sheshi</Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: 62 },
  headerBtn: { color: theme.text, fontWeight: "800", fontSize: 16 },
  signInBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    padding: 16,
    alignItems: "center",
  },
  signInText: { color: theme.primary, fontWeight: "700" },
});
