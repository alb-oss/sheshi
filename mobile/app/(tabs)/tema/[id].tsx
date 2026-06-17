import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiError, getThread } from "@/api";
import { PostCard } from "@/components/PostCard";
import { DockedComposer } from "@/components/DockedComposer";
import { ErrorState } from "@/components/ErrorState";
import { FeedSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/useAuth";
import { useDockOffset } from "@/useDockOffset";
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
  const offset = useDockOffset();
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(true);
  // 3-way: ok (thread present) / notfound (real 404 → "Tema nuk u gjet") / error (5xx / network →
  // retryable ErrorState). A blank thread is no longer conflated with a failed fetch.
  const [status, setStatus] = useState<"ok" | "notfound" | "error">("ok");
  const [reply, setReply] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setStatus("ok");
    try {
      setThread(await getThread(id));
    } catch (e) {
      setThread(null);
      setStatus(e instanceof ApiError && e.status === 404 ? "notfound" : "error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <View style={styles.flex}><FeedSkeleton /></View>;
  if (status === "error") {
    return (
      <View style={styles.flex}>
        <ErrorState onRetry={() => void load()} />
      </View>
    );
  }
  if (!thread) {
    return (
      <View style={styles.center}>
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
      <FlatList
        data={flat}
        keyExtractor={(f) => f.message.id}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <View>
            <PostCard message={thread.root} currentUserId={user?.id ?? null} onReply={user ? () => setReply(null) : undefined} />
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
                  currentUserId={user?.id ?? null}
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
        <DockedComposer
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
        <Pressable onPress={() => router.push("/auth")} style={[styles.signInBar, { paddingBottom: 16 + offset }]}>
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
      paddingHorizontal: 16,
      paddingTop: 16,
      alignItems: "center",
      backgroundColor: t.bg,
    },
    signInText: { color: t.primary, fontWeight: "700" },
  });
}
