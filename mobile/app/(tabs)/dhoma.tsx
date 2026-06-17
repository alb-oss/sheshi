import { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listRooms } from "@/api";
import { PressableScale } from "@/components/PressableScale";
import { ErrorState } from "@/components/ErrorState";
import { RoomsSkeleton } from "@/components/Skeleton";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { Room } from "@/types";

export default function Dhoma() {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinct from an empty list: the fetch rejected, so we offer a retry rather than nothing.
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    listRooms()
      .then((r) => {
        if (!alive) return;
        setRooms(r);
      })
      .catch(() => {
        if (!alive) return;
        setRooms([]);
        setError(true);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  if (loading) {
    return (
      <View style={styles.flex}>
        <RoomsSkeleton />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.flex}>
        <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
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
          <Ionicons name="chevron-forward" size={20} color={theme.textFaint} />
        </PressableScale>
      )}
    />
  );
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
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
  });
}
