import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme, radius } from "@/theme";
import type { MessageRow } from "@/types";
import { VoteControl } from "./VoteControl";

export function PostCard({
  message,
  onPress,
  onReply,
  compact,
}: {
  message: MessageRow;
  onPress?: () => void;
  onReply?: () => void;
  compact?: boolean;
}) {
  const name = message.author?.display_name || message.author?.username || "anonim";
  const handle = "@" + (message.author?.username || "anonim");
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const isDeleted = !!message.deleted_at;
  const time = relativeTime(message.created_at);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}>
      <View style={[styles.avatar, compact && styles.avatarSm]}>
        <Text style={styles.avatarText}>{initials || "??"}</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {handle}
          </Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.muted}>{time}</Text>
        </View>
        <Text style={[styles.body, isDeleted && styles.deleted]}>
          {isDeleted ? "[Mesazhi është fshirë]" : message.body}
        </Text>
        {!isDeleted && (
          <View style={styles.actions}>
            <VoteControl message={message} compact={compact} />
            {onReply ? (
              <Pressable hitSlop={6} onPress={onReply} style={styles.action}>
                <Text style={styles.actionIcon}>💬</Text>
                <Text style={styles.actionText}>Përgjigju</Text>
              </Pressable>
            ) : (
              <View style={styles.action}>
                <Text style={styles.actionIcon}>💬</Text>
                <Text style={styles.actionText}>{message.reply_count ?? 0}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "tani";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  pressed: { backgroundColor: theme.card },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: theme.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSm: { width: 30, height: 30 },
  avatarText: { color: theme.textMuted, fontWeight: "800", fontSize: 12 },
  content: { flex: 1, gap: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { color: theme.text, fontWeight: "800", fontSize: 14, flexShrink: 1 },
  muted: { color: theme.textMuted, fontSize: 13 },
  dot: { color: theme.textFaint, fontSize: 13 },
  body: { color: theme.text, fontSize: 15, lineHeight: 21 },
  deleted: { fontStyle: "italic", color: theme.textFaint },
  actions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 },
  action: { flexDirection: "row", alignItems: "center", gap: 5 },
  actionIcon: { fontSize: 13 },
  actionText: { color: theme.textMuted, fontWeight: "700", fontSize: 13 },
});
