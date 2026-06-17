import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";

// Shared "couldn't load" state for read screens. Distinct from an empty list: it means the fetch
// rejected (5xx / network), and offers a retry. Keeps the read path's error UX consistent with
// the writes (which already surface failures) and with the web app.
export function ErrorState({
  message = "Diçka shkoi keq. Provo përsëri.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.wrap}>
      <Ionicons name="cloud-offline-outline" size={48} color={theme.textFaint} />
      <Text style={styles.body}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.btn} accessibilityRole="button">
          <Text style={styles.btnText}>Provo përsëri</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    body: { color: t.textMuted, fontSize: 14, textAlign: "center" },
    btn: {
      marginTop: 4,
      backgroundColor: t.primary,
      borderRadius: radius.pill,
      paddingHorizontal: 28,
      paddingVertical: 12,
    },
    btnText: { color: t.onPrimary, fontWeight: "800", fontSize: 15 },
  });
}
