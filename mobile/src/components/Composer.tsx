import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { postMessage, type PickedImage, type PickedVideo } from "@/api";
import { PressableScale } from "@/components/PressableScale";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { MessageRow } from "@/types";

// Mirrors the server's MaxVideoBytes (50 MB); the byte-signature check on the API is the real
// gate, so this is just a fast fail before a doomed upload.
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

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
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const canSend = (body.trim().length > 0 || image !== null || video !== null) && !busy;

  // One attachment at a time: picking media clears whatever was attached before, so the preview
  // and the multipart payload stay unambiguous (matches the web composer).
  async function pickMedia() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];

    if (a.type === "video") {
      if (a.fileSize && a.fileSize > MAX_VIDEO_BYTES) {
        Alert.alert("Video", "Videoja duhet të jetë nën 50 MB.");
        return;
      }
      // mp4 and mov share the same ISO-BMFF 'ftyp' signature the API checks, so an iOS .mov sent
      // as video/mp4 still validates; pass the picked file through without re-encoding.
      const mimeType = a.mimeType || (a.fileName?.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4");
      setImage(null);
      setVideo({ uri: a.uri, mimeType, fileName: a.fileName ?? null });
      return;
    }

    try {
      // The API only accepts jpeg/png/webp and verifies the bytes match the declared type. iOS
      // photos are HEIC, so normalize to JPEG (and cap large images) before upload — otherwise the
      // server rejects the upload and the post silently fails.
      const ops = a.width && a.width > 1600 ? [{ resize: { width: 1600 } }] : [];
      const jpeg = await ImageManipulator.manipulateAsync(a.uri, ops, {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      setVideo(null);
      setImage({ uri: jpeg.uri, mimeType: "image/jpeg", fileName: "photo.jpg" });
    } catch {
      Alert.alert("Imazhi", "Nuk u përpunua dot ky imazh. Provo një tjetër.");
    }
  }

  async function send() {
    if (!canSend) return;
    setBusy(true);
    try {
      const m = await postMessage({ room_id: roomId, body: body.trim(), parent_id: parentId ?? null, image, video });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setBody("");
      setImage(null);
      setVideo(null);
      onPosted?.(m);
    } catch {
      // keep the text + attachment so the user can retry, but surface the failure (was silent)
      Alert.alert("Gabim", "Mesazhi nuk u dërgua. Provo sërish.");
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
      ) : video ? (
        <View style={styles.previewRow}>
          <ComposerVideoPreview uri={video.uri} style={styles.preview} />
          <View style={styles.previewBadge} pointerEvents="none">
            <Ionicons name="play" size={16} color={theme.onPrimary} />
          </View>
          <Pressable hitSlop={8} onPress={() => setVideo(null)} style={styles.previewRemove}>
            <Ionicons name="close" size={16} color={theme.onPrimary} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.bar}>
        <PressableScale onPress={pickMedia} style={styles.attach}>
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

// Mounted only when a video is attached, so the useVideoPlayer hook never spins up for text/image
// posts. Stays paused on the first frame (no play() call) as a lightweight thumbnail.
function ComposerVideoPreview({ uri, style }: { uri: string; style: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
  });
  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
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
    preview: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: t.card2, overflow: "hidden" },
    previewBadge: {
      position: "absolute",
      top: 36,
      left: 36,
      width: 24,
      height: 24,
      borderRadius: radius.pill,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
    },
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
