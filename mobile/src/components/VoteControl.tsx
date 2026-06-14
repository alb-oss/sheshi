import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { setVote } from "@/api";
import { theme, radius } from "@/theme";
import type { MessageRow } from "@/types";

// Reddit-style up/score/down pill. Optimistic, with light haptics — iPhone-like.
export function VoteControl({ message, compact }: { message: MessageRow; compact?: boolean }) {
  const [score, setScore] = useState(message.score ?? 0);
  const [myVote, setMyVote] = useState(message.my_vote ?? 0);
  const [busy, setBusy] = useState(false);

  async function vote(dir: 1 | -1) {
    if (busy) return;
    const prevVote = myVote;
    const prevScore = score;
    const next = (myVote === dir ? 0 : dir) as -1 | 0 | 1;
    setMyVote(next);
    setScore(prevScore - prevVote + next);
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

  const size = compact ? 18 : 20;
  const scoreColor = myVote === 1 ? theme.primary : myVote === -1 ? theme.downvote : theme.text;
  const tint =
    myVote === 1 ? "rgba(245,51,63,0.12)" : myVote === -1 ? "rgba(110,139,255,0.12)" : theme.card2;

  return (
    <View style={[styles.pill, { backgroundColor: tint }]}>
      <Pressable hitSlop={8} onPress={() => vote(1)} style={styles.btn}>
        <Arrow dir="up" color={myVote === 1 ? theme.primary : theme.textMuted} size={size} filled={myVote === 1} />
      </Pressable>
      <Text style={[styles.score, { color: scoreColor }]}>{formatScore(score)}</Text>
      <Pressable hitSlop={8} onPress={() => vote(-1)} style={styles.btn}>
        <Arrow dir="down" color={myVote === -1 ? theme.downvote : theme.textMuted} size={size} filled={myVote === -1} />
      </Pressable>
    </View>
  );
}

// Lightweight chevron-style arrow drawn with two rotated bars (no icon dependency).
function Arrow({ dir, color, size, filled }: { dir: "up" | "down"; color: string; size: number; filled: boolean }) {
  return (
    <Text style={{ color, fontSize: size, fontWeight: filled ? "900" : "700", lineHeight: size + 2 }}>
      {dir === "up" ? "▲" : "▼"}
    </Text>
  );
}

function formatScore(n: number) {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    paddingVertical: 2,
    gap: 2,
  },
  btn: { paddingHorizontal: 6, paddingVertical: 4 },
  score: { fontSize: 13, fontWeight: "800", minWidth: 22, textAlign: "center" },
});
