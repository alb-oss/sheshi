import { useMemo } from "react";
import { Image, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { resolveImageUrl, resolveVideoUrl } from "@/api";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
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
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
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
        {isDeleted || message.body ? (
          <Text style={[styles.body, isDeleted && styles.deleted]}>
            {isDeleted ? "[Mesazhi është fshirë]" : message.body}
          </Text>
        ) : null}
        {!isDeleted && message.image_url ? (
          <Image source={{ uri: resolveImageUrl(message.image_url) }} style={styles.image} resizeMode="cover" />
        ) : null}
        {!isDeleted && message.video_url ? (
          <VideoAttachment uri={resolveVideoUrl(message.video_url)} style={styles.image} />
        ) : null}
        {!isDeleted && (
          <View style={styles.actions}>
            <VoteControl message={message} compact={compact} />
            {onReply ? (
              <Pressable hitSlop={6} onPress={onReply} style={styles.action}>
                <Ionicons name="chatbubble-outline" size={14} color={theme.textMuted} />
                <Text style={styles.actionText}>Përgjigju</Text>
              </Pressable>
            ) : (
              <View style={styles.action}>
                <Ionicons name="chatbubble-outline" size={14} color={theme.textMuted} />
                <Text style={styles.actionText}>{message.reply_count ?? 0}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

// Its own component so useVideoPlayer only runs for posts that actually carry a video — feed cards
// without one never instantiate a player. Native controls handle play/scrub/fullscreen; starts
// paused on the first frame and muted (no autoplay in a scrolling feed).
function VideoAttachment({ uri, style }: { uri: string; style: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
  });
  return <VideoView player={player} style={style} contentFit="contain" nativeControls allowsFullscreen />;
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

function makeStyles(t: Palette) {
  return StyleSheet.create({
    row: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
    pressed: { backgroundColor: t.card },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: t.card2,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarSm: { width: 30, height: 30 },
    avatarText: { color: t.textMuted, fontWeight: "800", fontSize: 12 },
    content: { flex: 1, gap: 4 },
    header: { flexDirection: "row", alignItems: "center", gap: 5 },
    name: { color: t.text, fontWeight: "800", fontSize: 14, flexShrink: 1 },
    muted: { color: t.textMuted, fontSize: 13 },
    dot: { color: t.textFaint, fontSize: 13 },
    body: { color: t.text, fontSize: 15, lineHeight: 21 },
    image: { width: "100%", height: 200, borderRadius: radius.md, marginTop: 6, backgroundColor: t.card2 },
    deleted: { fontStyle: "italic", color: t.textFaint },
    actions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 },
    action: { flexDirection: "row", alignItems: "center", gap: 5 },
    actionText: { color: t.textMuted, fontWeight: "700", fontSize: 13 },
  });
}
