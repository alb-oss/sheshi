// Shimmer placeholders shown while a list loads — a smoother, more native feel than a bare
// spinner. A single Animated opacity loop drives a soft pulse.
import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View, type DimensionValue } from "react-native";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";

function Block({ w, h, style }: { w?: DimensionValue; h: number; style?: object }) {
  const { theme } = useTheme();
  const op = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.9, duration: 750, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0.45, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [op]);
  return (
    <Animated.View
      style={[{ width: w ?? "100%", height: h, borderRadius: radius.sm, backgroundColor: theme.card2, opacity: op }, style]}
    />
  );
}

export function FeedSkeleton({ rows = 7 }: { rows?: number }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.wrap}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Block w={36} h={36} style={{ borderRadius: 18 }} />
          <View style={styles.body}>
            <Block w="55%" h={12} />
            <Block w="92%" h={12} />
            <Block w={72} h={22} style={{ borderRadius: radius.pill, marginTop: 4 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function RoomsSkeleton({ rows = 4 }: { rows?: number }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.cards}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.card}>
          <Block w={40} h={40} style={{ borderRadius: 20 }} />
          <View style={styles.body}>
            <Block w="45%" h={14} />
            <Block w="75%" h={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    wrap: { paddingTop: 6 },
    row: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
    body: { flex: 1, gap: 8, paddingTop: 2 },
    cards: { padding: 12, gap: 10 },
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
  });
}
