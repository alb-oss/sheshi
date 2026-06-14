import { useEffect, useState } from "react";
import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { SheshiError, setVote, type MessageRow } from "@/lib/sheshi";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Reddit-style up/down vote pill: ▲ score ▼. Up is the Albanian-red accent, down is indigo,
// the score takes the colour of the caller's vote. Optimistic with a tap "pop" animation;
// re-syncs from props (e.g. realtime score updates) and rolls back on error.
export function VoteControl({
  message,
  currentUserId,
  compact,
}: {
  message: MessageRow;
  currentUserId: string | null;
  compact?: boolean;
}) {
  const [score, setScore] = useState(message.score ?? 0);
  const [myVote, setMyVote] = useState(message.my_vote ?? 0);
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState(0);

  useEffect(() => {
    setScore(message.score ?? 0);
    setMyVote(message.my_vote ?? 0);
  }, [message.id, message.score, message.my_vote]);

  async function vote(dir: 1 | -1) {
    if (!currentUserId) {
      toast.error(sq.chat.signInToPost);
      return;
    }
    if (busy) return;

    const prevVote = myVote;
    const prevScore = score;
    const next = myVote === dir ? 0 : dir; // clicking your current vote clears it
    setMyVote(next);
    setScore(prevScore - prevVote + next);
    if (next !== 0) setPop((p) => p + 1);
    setBusy(true);
    try {
      // No refetch: the optimistic state above + the realtime `vote_changed` echo (which the
      // feed/thread apply to local state) keep the score current. A full reload here would
      // re-fetch the whole page on every click and flicker.
      await setVote(message.id, next as -1 | 0 | 1);
    } catch (error) {
      setMyVote(prevVote);
      setScore(prevScore);
      toast.error(
        error instanceof SheshiError && error.code === "UNAUTH"
          ? sq.errors.auth
          : error instanceof SheshiError && error.code === "RATE_LIMITED"
            ? sq.errors.rateLimited
            : "Vota nuk u ruajt. Provo sërish.",
      );
    } finally {
      setBusy(false);
    }
  }

  const icon = compact ? "h-[18px] w-[18px]" : "h-5 w-5";
  const btn = "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:opacity-60";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-secondary/70 p-0.5 transition-colors",
        myVote === 1 && "bg-upvote/12",
        myVote === -1 && "bg-downvote/12",
      )}
    >
      <button
        type="button"
        onClick={() => vote(1)}
        disabled={busy}
        aria-label={sq.chat.upvote}
        aria-pressed={myVote === 1}
        className={cn(btn, myVote === 1 ? "text-upvote" : "text-foreground/55 hover:bg-upvote/15 hover:text-upvote")}
      >
        <ArrowBigUp
          key={`up-${pop}`}
          className={cn(icon, myVote === 1 && "animate-pop")}
          fill={myVote === 1 ? "currentColor" : "none"}
          aria-hidden
        />
      </button>
      <span
        className={cn(
          "min-w-6 text-center text-xs font-bold tabular-nums transition-colors",
          myVote === 1 ? "text-upvote" : myVote === -1 ? "text-downvote" : "text-foreground/80",
        )}
      >
        {formatScore(score)}
      </span>
      <button
        type="button"
        onClick={() => vote(-1)}
        disabled={busy}
        aria-label="Kundërshto"
        aria-pressed={myVote === -1}
        className={cn(btn, myVote === -1 ? "text-downvote" : "text-foreground/55 hover:bg-downvote/15 hover:text-downvote")}
      >
        <ArrowBigDown
          key={`down-${pop}`}
          className={cn(icon, myVote === -1 && "animate-pop")}
          fill={myVote === -1 ? "currentColor" : "none"}
          aria-hidden
        />
      </button>
    </div>
  );
}

function formatScore(n: number) {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
