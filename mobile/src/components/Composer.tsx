import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { postMessage, type PickedImage } from "@/api";
import { PressableScale } from "@/components/PressableScale";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { MessageRow } from "@/types";

export function Composer({
  roomId,
  parentId,
  replyLabel,
  placeholder,
  onCancelReply,
  onPosted,
}: {
  roomId: string;
  parentId?: string | null;
  replyLabel?: string | null;
  placeholder?: string;
  onCancelReply?: () => void;
  onPosted?: (m: MessageRow) => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [body, setBody] = useState("");
  const [image, setImage] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const canSend = (body.trim().length > 0 || image !== null) && !busy;

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      setImage({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName });
    }
  }

  async function send() {
    if (!canSend) return;
    setBusy(true);
    try {
      const m = await postMessage({ room_id: roomId, body: body.trim(), parent_id: parentId ?? null, image });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setBody("");
      setImage(null);
      onPosted?.(m);
    } catch {
      // keep the text + image so the user can retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {replyLabel ? (
        <View style={styles.replyChip}>
          <Text style={styles.replyText} numberOfLines={1}>
            Përgjigje për {replyLabel}
          </Text>
          <Pressable hitSlop={8} onPress={onCancelReply}>
            <Text style={styles.cancel}>✕</Text>
          </Pressable>
        </View>
      ) : null}
      {image ? (
        <View style={styles.previewRow}>
          <Image source={{ uri: image.uri }} style={styles.preview} />
          <Pressable hitSlop={8} onPress={() => setImage(null)} style={styles.previewRemove}>
            <Ionicons name="close" size={16} color={theme.onPrimary} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.bar}>
        <PressableScale onPress={pickImage} style={styles.attach}>
          <Ionicons name="image-outline" size={22} color={theme.textMuted} />
        </PressableScale>
        <TextInput
          value={body}
          onChangeText={setBody}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={replyLabel ? "Shkruaj një përgjigje…" : placeholder ?? "Shkruaj në sheshi…"}
          placeholderTextColor={theme.textFaint}
          style={[styles.input, focused && styles.inputFocused]}
          multiline
        />
        <PressableScale onPress={send} disabled={!canSend} style={[styles.send, !canSend && styles.sendOff]}>
          {busy ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <Ionicons name="arrow-up" size={22} color={canSend ? theme.onPrimary : theme.textFaint} />
          )}
        </PressableScale>
      </View>
    </View>
  );
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    wrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
      backgroundColor: t.bg,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 10,
      gap: 8,
    },
    replyChip: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: t.card,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    replyText: { color: t.primary, fontWeight: "700", fontSize: 12, flex: 1, marginRight: 8 },
    cancel: { color: t.textMuted, fontSize: 14, fontWeight: "700" },
    bar: { flexDirection: "row", alignItems: "center", gap: 8 },
    attach: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
    previewRow: { alignSelf: "flex-start", marginLeft: 4 },
    preview: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: t.card2 },
    previewRemove: {
      position: "absolute",
      top: -6,
      right: -6,
      width: 24,
      height: 24,
      borderRadius: radius.pill,
      backgroundColor: t.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      backgroundColor: t.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      color: t.text,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 12,
    },
    inputFocused: { borderColor: t.primary },
    send: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: t.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    sendOff: { backgroundColor: t.card2 },
  });
}
