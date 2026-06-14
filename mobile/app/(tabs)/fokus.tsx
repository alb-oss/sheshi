import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { listHighlights } from "@/api";
import { theme, radius } from "@/theme";
import type { MessageRow } from "@/types";

const MODES = [
  { key: "hot", label: "Hot" },
  { key: "top", label: "Top sot" },
  { key: "replied", label: "Më të përgjigjura" },
] as const;

export default function Fokus() {
  const [mode, setMode] = useState<(typeof MODES)[number]["key"]>("hot");
  const [items, setItems] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listHighlights(mode)
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [mode]);

  return (
    <View style={styles.flex}>
      <View style={styles.segment}>
        {MODES.map((m) => (
          <Pressable
            key={m.key}
            onPress={() => setMode(m.key)}
            style={[styles.segBtn, mode === m.key && styles.segActive]}
          >
            <Text style={[styles.segText, mode === m.key && styles.segTextActive]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(m) => m.id}
          contentInsetAdjustmentBehavior="automatic"
          ListEmptyComponent={<Text style={styles.empty}>Asgjë në fokus ende.</Text>}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => router.push(`/tema/${item.id}`)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.card }]}
            >
              <Text style={[styles.rank, index < 3 && styles.rankTop]}>
                {String(index + 1).padStart(2, "0")}
              </Text>
              <View style={styles.rowBody}>
                <Text style={styles.body} numberOfLines={3}>
                  {item.body}
                </Text>
                <View style={styles.meta}>
                  <Text style={styles.metaStrong}>▲ {item.score ?? 0}</Text>
                  <Text style={styles.metaMuted}>💬 {item.reply_count ?? 0}</Text>
                </View>
              </View>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: theme.textMuted, textAlign: "center", marginTop: 40 },
  segment: { flexDirection: "row", gap: 6, padding: 12 },
  segBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: theme.card },
  segActive: { backgroundColor: theme.primary },
  segText: { color: theme.textMuted, fontWeight: "700", fontSize: 13 },
  segTextActive: { color: theme.onPrimary },
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rank: { color: theme.textFaint, fontWeight: "900", fontSize: 16, width: 26, paddingTop: 1 },
  rankTop: { color: theme.primary, fontSize: 18 },
  rowBody: { flex: 1, gap: 8 },
  body: { color: theme.text, fontSize: 15, lineHeight: 21 },
  meta: { flexDirection: "row", gap: 14 },
  metaStrong: { color: theme.primary, fontWeight: "800", fontSize: 13 },
  metaMuted: { color: theme.textMuted, fontWeight: "700", fontSize: 13 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: 54 },
});
