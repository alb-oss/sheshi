import { useMemo, useState } from "react";
import { Alert, Image, Modal, Pressable, Share, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { ApiError, resolveImageUrl, resolveVideoUrl, submitReport, threadUrl, type ReportReason } from "@/api";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { MessageRow } from "@/types";
import { VoteControl } from "./VoteControl";

// Mirrors the web report dialog's reasons (sq.report.reasons).
const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: "spam", label: "Spam" },
  { key: "hate", label: "Gjuhë urrejtjeje" },
  { key: "doxxing", label: "Doxxing / të dhëna personale" },
  { key: "violence", label: "Dhunë ose kërcënim" },
  { key: "other", label: "Tjetër" },
];

export function PostCard({
  message,
  onPress,
  onReply,
  compact,
  currentUserId,
}: {
  message: MessageRow;
  onPress?: () => void;
  onReply?: () => void;
  compact?: boolean;
  currentUserId?: string | null;
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
  const [viewerOpen, setViewerOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Match the web: only logged-in users can report, and never your own message.
  const canReport = !!currentUserId && currentUserId !== message.author_id;

  async function report(reason: ReportReason) {
    setReportOpen(false);
    try {
      await submitReport(message.id, reason);
      Alert.alert("Faleminderit", "Raporti u dërgua.");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      Alert.alert(
        "Gabim",
        status === 401 ? "Kërkohet hyrja." : status === 429 ? "Shumë veprime. Provo pas pak." : "Raporti nuk u dërgua.",
      );
    }
  }

  async function onShare() {
    const url = threadUrl(message.id);
    const text = message.body?.trim();
    // Single `message` field (no separate `url`) works on both iOS and Android without the link
    // being duplicated in the share sheet.
    try {
      await Share.share({ message: text ? `${text}\n\n${url}` : url });
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  }

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
          // Nested Pressable: tapping the image becomes the touch responder and opens the viewer,
          // so it doesn't also trigger the row's onPress (which opens the thread).
          <Pressable onPress={() => setViewerOpen(true)}>
            <Image source={{ uri: resolveImageUrl(message.image_url) }} style={styles.image} resizeMode="cover" />
          </Pressable>
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
            <Pressable hitSlop={6} onPress={onShare} style={styles.action} accessibilityLabel="Shpërnda">
              <Ionicons name="share-outline" size={15} color={theme.textMuted} />
              <Text style={styles.actionText}>Shpërnda</Text>
            </Pressable>
            {canReport ? (
              <Pressable hitSlop={6} onPress={() => setReportOpen(true)} style={styles.action} accessibilityLabel="Raporto">
                <Ionicons name="flag-outline" size={15} color={theme.textMuted} />
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {canReport ? (
        <Modal
          visible={reportOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setReportOpen(false)}
        >
          <Pressable style={styles.sheetBackdrop} onPress={() => setReportOpen(false)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Raporto mesazhin</Text>
              {REPORT_REASONS.map((r) => (
                <Pressable key={r.key} style={styles.reasonRow} onPress={() => void report(r.key)}>
                  <Text style={styles.reasonText}>{r.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.textFaint} />
                </Pressable>
              ))}
              <Pressable style={styles.sheetCancel} onPress={() => setReportOpen(false)}>
                <Text style={styles.sheetCancelText}>Anulo</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {!isDeleted && message.image_url ? (
        <Modal
          visible={viewerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setViewerOpen(false)}
        >
          <Pressable style={styles.viewerBackdrop} onPress={() => setViewerOpen(false)}>
            <Image
              source={{ uri: resolveImageUrl(message.image_url) }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
            <Pressable style={styles.viewerClose} hitSlop={12} onPress={() => setViewerOpen(false)}>
              <Ionicons name="close" size={30} color="#fff" />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
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
    viewerBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.94)",
      alignItems: "center",
      justifyContent: "center",
    },
    viewerImage: { width: "100%", height: "82%" },
    viewerClose: { position: "absolute", top: 52, right: 20 },
    sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: t.bg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 28,
    },
    sheetTitle: { color: t.text, fontWeight: "800", fontSize: 16, marginBottom: 8 },
    reasonRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
    },
    reasonText: { color: t.text, fontSize: 15 },
    sheetCancel: { marginTop: 14, alignItems: "center", paddingVertical: 12, backgroundColor: t.card, borderRadius: radius.md },
    sheetCancelText: { color: t.textMuted, fontWeight: "700", fontSize: 14 },
  });
}
