import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listRooms } from "@/api";
import { PressableScale } from "@/components/PressableScale";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { Room } from "@/types";

export default function Dhoma() {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listRooms()
      .then((r) => alive && setRooms(r))
      .catch(() => alive && setRooms([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.flex}
      data={rooms}
      keyExtractor={(r) => r.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 61, gap: 10 }}
      renderItem={({ item }) => (
        <PressableScale onPress={() => router.push(`/dhoma/${item.slug}`)} style={styles.card}>
          <View style={styles.hash}>
            <Text style={styles.hashText}>#</Text>
          </View>
          <View style={styles.body}>
            <Text style={styles.name}>{item.name}</Text>
            {item.description ? (
              <Text style={styles.desc} numberOfLines={1}>
                {item.description}
              </Text>
            ) : null}
          </View>
          <Text style={styles.chevron}>›</Text>
        </PressableScale>
      )}
    />
  );
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: t.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 14,
    },
    hash: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: t.card2,
      alignItems: "center",
      justifyContent: "center",
    },
    hashText: { color: t.primary, fontWeight: "900", fontSize: 18 },
    body: { flex: 1 },
    name: { color: t.text, fontWeight: "800", fontSize: 16 },
    desc: { color: t.textMuted, fontSize: 13, marginTop: 2 },
    chevron: { color: t.textFaint, fontSize: 22, fontWeight: "700" },
  });
}
