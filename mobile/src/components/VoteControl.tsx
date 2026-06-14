import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { setVote } from "@/api";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { MessageRow } from "@/types";

// Reddit-style up/score/down pill. Optimistic, with light haptics and a spring "pop" on the
// tapped arrow — iPhone-like.
export function VoteControl({ message, compact }: { message: MessageRow; compact?: boolean }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [score, setScore] = useState(message.score ?? 0);
  const [myVote, setMyVote] = useState(message.my_vote ?? 0);
  const [busy, setBusy] = useState(false);
  const upPop = useRef(new Animated.Value(1)).current;
  const downPop = useRef(new Animated.Value(1)).current;

  function pop(v: Animated.Value) {
    v.setValue(0.7);
    Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 14 }).start();
  }

  async function vote(dir: 1 | -1) {
    if (busy) return;
    const prevVote = myVote;
    const prevScore = score;
    const next = (myVote === dir ? 0 : dir) as -1 | 0 | 1;
    setMyVote(next);
    setScore(prevScore - prevVote + next);
    if (next !== 0) pop(dir === 1 ? upPop : downPop);
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await setVote(message.id, next);
    } catch {
      setMyVote(prevVote);
      setScore(prevScore);
    } finally {
      setBusy(false);
    }
  }

  const size = compact ? 17 : 19;
  const scoreColor = myVote === 1 ? theme.primary : myVote === -1 ? theme.downvote : theme.text;
  const tint = myVote === 1 ? theme.upTint : myVote === -1 ? theme.downTint : theme.card2;

  return (
    <View style={[styles.pill, { backgroundColor: tint }]}>
      <Pressable hitSlop={8} onPress={() => vote(1)} style={styles.btn}>
        <Animated.View style={{ transform: [{ scale: upPop }] }}>
          <Ionicons name="caret-up" size={size} color={myVote === 1 ? theme.primary : theme.textMuted} />
        </Animated.View>
      </Pressable>
      <Text style={[styles.score, { color: scoreColor }]}>{formatScore(score)}</Text>
      <Pressable hitSlop={8} onPress={() => vote(-1)} style={styles.btn}>
        <Animated.View style={{ transform: [{ scale: downPop }] }}>
          <Ionicons name="caret-down" size={size} color={myVote === -1 ? theme.downvote : theme.textMuted} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

function formatScore(n: number) {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: radius.pill,
      paddingHorizontal: 4,
      paddingVertical: 2,
      gap: 2,
    },
    btn: { paddingHorizontal: 6, paddingVertical: 4 },
    score: { fontSize: 13, fontWeight: "800", minWidth: 20, textAlign: "center" },
  });
}
