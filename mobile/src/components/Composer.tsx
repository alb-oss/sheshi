import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { postMessage } from "@/api";
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
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const canSend = body.trim().length > 0 && !busy;

  async function send() {
    if (!canSend) return;
    setBusy(true);
    try {
      const m = await postMessage({ room_id: roomId, body: body.trim(), parent_id: parentId ?? null });
      setBody("");
      onPosted?.(m);
    } catch {
      // keep the text so the user can retry
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
      <View style={styles.bar}>
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
        <Pressable onPress={send} disabled={!canSend} style={[styles.send, !canSend && styles.sendOff]}>
          {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={styles.sendText}>↑</Text>}
        </Pressable>
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
    bar: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
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
    sendText: { color: t.onPrimary, fontSize: 22, fontWeight: "900", marginTop: -2 },
  });
}
