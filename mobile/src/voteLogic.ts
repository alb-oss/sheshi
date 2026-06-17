// Pure vote math, shared by VoteControl. Kept out of the component so the optimistic-update logic
// and the score formatter are unit-testable without rendering Animated/Haptics/theme.

export type VoteDir = 1 | -1;
export type VoteValue = -1 | 0 | 1;

// Tapping a direction you already hold clears the vote (toggle); otherwise it sets that direction.
export function nextVote(current: VoteValue, dir: VoteDir): VoteValue {
  return (current === dir ? 0 : dir) as VoteValue;
}

// New net score after switching from `prevVote` to `next`: remove the old contribution, add the new.
export function optimisticScore(prevScore: number, prevVote: VoteValue, next: VoteValue): number {
  return prevScore - prevVote + next;
}

// Compact display: 1.2k, 12k, etc. above 1000; otherwise the plain integer.
export function formatScore(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
