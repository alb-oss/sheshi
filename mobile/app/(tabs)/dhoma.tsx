import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { listRooms } from "@/api";
import { theme, radius } from "@/theme";
import type { Room } from "@/types";

export default function Dhoma() {
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
      contentContainerStyle={{ padding: 12, gap: 10 }}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/dhoma/${item.slug}`)}
          style={({ pressed }) => [styles.card, pressed && { borderColor: theme.primary }]}
        >
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
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: 14,
  },
  hash: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: theme.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  hashText: { color: theme.primary, fontWeight: "900", fontSize: 18 },
  body: { flex: 1 },
  name: { color: theme.text, fontWeight: "800", fontSize: 16 },
  desc: { color: theme.textMuted, fontSize: 13, marginTop: 2 },
  chevron: { color: theme.textFaint, fontSize: 22, fontWeight: "700" },
});
