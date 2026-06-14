import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { getThread } from "@/api";
import { PostCard } from "@/components/PostCard";
import { Composer } from "@/components/Composer";
import { AuthButton } from "@/components/AuthButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FeedSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/useAuth";
import { type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { MessageRow, ReplyNode, ThreadData } from "@/types";

type Flat = { message: MessageRow; depth: number };

function flatten(nodes: ReplyNode[], out: Flat[] = []): Flat[] {
  for (const n of nodes) {
    out.push({ message: n.message, depth: n.depth });
    flatten(n.replies, out);
  }
  return out;
}

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setThread(await getThread(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const headerActions = (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <ThemeToggle />
      <AuthButton />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ title: "Tema", headerRight: () => headerActions }} />
        <FeedSkeleton />
      </View>
    );
  }
  if (!thread) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Tema", headerRight: () => headerActions }} />
        <Text style={styles.muted}>Tema nuk u gjet.</Text>
      </View>
    );
  }

  const flat = flatten(thread.replies);
  const replyLabel = (m: MessageRow) => "@" + (m.author?.username || "anonim");

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      <Stack.Screen options={{ title: "Tema", headerRight: () => headerActions }} />
      <FlatList
        data={flat}
        keyExtractor={(f) => f.message.id}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <View>
            <PostCard message={thread.root} onReply={user ? () => setReply(null) : undefined} />
            <View style={styles.divider}>
              <Text style={styles.dividerText}>
                {flat.length === 1 ? "1 përgjigje" : `${flat.length} përgjigje`}
              </Text>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const indent = Math.min(item.depth - 1, 6) * 14;
          return (
            <View style={{ marginLeft: indent, flexDirection: "row" }}>
              <View style={styles.threadLine} />
              <View style={{ flex: 1 }}>
                <PostCard
                  message={item.message}
                  compact
                  onPress={() => router.push(`/tema/${item.message.id}`)}
                  onReply={user ? () => setReply({ id: item.message.id, label: replyLabel(item.message) }) : undefined}
                />
              </View>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
      {user ? (
        <Composer
          roomId={thread.root.room_id}
          parentId={reply?.id ?? thread.root.id}
          replyLabel={reply?.label ?? null}
          onCancelReply={() => setReply(null)}
          onPosted={() => {
            setReply(null);
            load();
          }}
        />
      ) : (
        <Pressable onPress={() => router.push("/auth")} style={styles.signInBar}>
          <Text style={styles.signInText}>Hyr për t'u përgjigjur</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg },
    muted: { color: t.textMuted },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.card,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    dividerText: { color: t.textMuted, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
    threadLine: { width: StyleSheet.hairlineWidth, backgroundColor: t.threadLine, marginLeft: 8 },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: t.border },
    signInBar: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
      padding: 16,
      alignItems: "center",
    },
    signInText: { color: t.primary, fontWeight: "700" },
  });
}
