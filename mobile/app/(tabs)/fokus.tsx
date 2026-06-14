import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listHighlights } from "@/api";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { MessageRow } from "@/types";

const MODES = [
  { key: "hot", label: "Hot" },
  { key: "top", label: "Top sot" },
  { key: "replied", label: "Më të përgjigjura" },
] as const;

export default function Fokus() {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
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
          contentContainerStyle={{ paddingBottom: insets.bottom + 57 }}
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

function makeStyles(t: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    empty: { color: t.textMuted, textAlign: "center", marginTop: 40 },
    segment: { flexDirection: "row", gap: 6, padding: 12 },
    segBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: t.card },
    segActive: { backgroundColor: t.primary },
    segText: { color: t.textMuted, fontWeight: "700", fontSize: 13 },
    segTextActive: { color: t.onPrimary },
    row: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    rank: { color: t.textFaint, fontWeight: "900", fontSize: 16, width: 26, paddingTop: 1 },
    rankTop: { color: t.primary, fontSize: 18 },
    rowBody: { flex: 1, gap: 8 },
    body: { color: t.text, fontSize: 15, lineHeight: 21 },
    meta: { flexDirection: "row", gap: 14 },
    metaStrong: { color: t.primary, fontWeight: "800", fontSize: 13 },
    metaMuted: { color: t.textMuted, fontWeight: "700", fontSize: 13 },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: 54 },
  });
}
