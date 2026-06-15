import { useEffect, useRef, useState } from "react";
import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { SheshiError, setVote, type MessageRow } from "@/lib/sheshi";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Reddit-style up/down vote pill: ▲ score ▼. Up is the Albanian-red accent, down is indigo, the score
// takes the colour of the caller's vote.
//
// Two pieces of local state keep it correct under fast clicks and live updates:
//   • myVote       — the caller's optimistic intent (flips instantly on click).
//   • serverVote   — the vote the server has recorded for the caller, which message.score ALREADY
//                    includes.
// The displayed score overlays the optimistic delta on the server total:
//   displayScore = message.score + (myVote − serverVote)
// so the realtime `vote_changed` echo — which carries only the net score, never a per-user my_vote —
// can move message.score (e.g. someone else votes) without ever clobbering the caller's own vote.
// Writes are coalesced: at most one request is in flight, and when it settles the sender sends the
// caller's LATEST intent, so mashing the button is ~1–2 requests that converge (never N stacked votes,
// never a dropped final vote, never tripping the 30/min write limit).
export function VoteControl({
  message,
  currentUserId,
  compact,
}: {
  message: MessageRow;
  currentUserId: string | null;
  compact?: boolean;
}) {
  const [myVote, setMyVote] = useState(message.my_vote ?? 0);
  const [serverVote, setServerVote] = useState(message.my_vote ?? 0);
  const [pop, setPop] = useState(0);

  const idRef = useRef(message.id);
  const myVoteRef = useRef(myVote); // latest intent, readable synchronously by the sender
  const serverVoteRef = useRef(serverVote);
  const sendingRef = useRef(false);

  // Adopt the server's record only when a different message renders into this slot, or when a refetch
  // delivers a new my_vote and nothing is pending locally. Never re-sync on a bare score echo (it
  // carries no my_vote), and never clobber an in-flight optimistic vote.
  useEffect(() => {
    const fresh = message.my_vote ?? 0;
    const idChanged = idRef.current !== message.id;
    idRef.current = message.id;
    const pending = myVoteRef.current !== serverVoteRef.current;
    if (idChanged || (!pending && fresh !== serverVoteRef.current)) {
      myVoteRef.current = fresh;
      serverVoteRef.current = fresh;
      setMyVote(fresh);
      setServerVote(fresh);
    }
  }, [message.id, message.my_vote]);

  // Self-converging sender: one request in flight at a time; when it settles, if the intent changed
  // during the flight, send the latest. Rolls the optimistic vote back to the last confirmed value on
  // error.
  async function syncVotes() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      while (myVoteRef.current !== serverVoteRef.current) {
        const target = myVoteRef.current;
        try {
          await setVote(message.id, target as -1 | 0 | 1);
        } catch (error) {
          myVoteRef.current = serverVoteRef.current;
          setMyVote(serverVoteRef.current);
          toast.error(
            error instanceof SheshiError && error.code === "UNAUTH"
              ? sq.errors.auth
              : error instanceof SheshiError && error.code === "RATE_LIMITED"
                ? sq.errors.rateLimited
                : "Vota nuk u ruajt. Provo sërish.",
          );
          break;
        }
        serverVoteRef.current = target;
        setServerVote(target);
      }
    } finally {
      sendingRef.current = false;
    }
  }

  function click(dir: 1 | -1) {
    if (!currentUserId) {
      toast.error(sq.chat.signInToPost);
      return;
    }
    const next = myVoteRef.current === dir ? 0 : dir; // clicking your current vote clears it
    myVoteRef.current = next;
    setMyVote(next);
    if (next !== 0) setPop((p) => p + 1);
    void syncVotes();
  }

  const displayScore = (message.score ?? 0) + myVote - serverVote;
  const icon = compact ? "h-[18px] w-[18px]" : "h-5 w-5";
  const btn = "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors";

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
        onClick={() => click(1)}
        aria-label={sq.chat.upvote}
        aria-pressed={myVote === 1}
        className={cn(
          btn,
          myVote === 1 ? "text-upvote" : "text-foreground/55 hover:bg-upvote/15 hover:text-upvote",
        )}
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
        {formatScore(displayScore)}
      </span>
      <button
        type="button"
        onClick={() => click(-1)}
        aria-label="Kundërshto"
        aria-pressed={myVote === -1}
        className={cn(
          btn,
          myVote === -1
            ? "text-downvote"
            : "text-foreground/55 hover:bg-downvote/15 hover:text-downvote",
        )}
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
