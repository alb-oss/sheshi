import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { SheshiError, setVote, type MessageRow } from "@/lib/sheshi";
import { sq } from "@/i18n/sq";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Reddit-style up/down vote pill: ▲ score ▼. Up is the Albanian-red accent, down is indigo, the score
// takes the colour of the caller's vote.
//
// THE CACHE IS THE SINGLE SOURCE OF TRUTH. The displayed vote (colour) and score derive *directly*
// from the `message` prop — i.e. from the React Query cache that the feed, thread, highlights and
// single-message views all share. A click writes the new vote into every cache holding this message
// (optimistic AND persisted, so the colour survives a refresh) and adjusts the score by the delta;
// the realtime `vote_changed` echo later overwrites the score with the server's absolute total,
// idempotently. Because NOTHING about the display lives in component state, the control cannot drift
// out of sync with the cache — the old "stuck colour / won't toggle off" failures are gone by
// construction (they came from a parallel myVote/serverVote state machine diverging from the cache).
//
// The only local state is the network bookkeeping below, which never feeds the display:
//   • targetRef    — the caller's latest intended vote (what the next request should send).
//   • confirmedRef — the vote the server has acknowledged.
// The sender is coalesced: at most one request in flight; when it settles it sends the LATEST intent,
// so mashing the button collapses to ~1–2 requests that converge (never N stacked votes, never a
// dropped final vote, never tripping the 30/min write limit).
export function VoteControl({
  message,
  currentUserId,
  compact,
}: {
  message: MessageRow;
  currentUserId: string | null;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const myVote = message.my_vote ?? 0; // derived truth — there is deliberately no useState for this
  const score = message.score ?? 0; // already includes the optimistic delta we wrote on click
  const [pop, setPop] = useState(0);

  const targetRef = useRef(myVote);
  const confirmedRef = useRef(myVote);
  const sendingRef = useRef(false);
  const idRef = useRef(message.id);

  // Reconcile the network refs with the server's record when it changes underneath us — a refetch
  // delivering a new my_vote, or a different message rendering into this slot. Skip while a write is
  // pending so we never clobber an in-flight optimistic vote. The realtime echo only moves `score`
  // (never my_vote), so this stays quiet on a bare vote echo.
  useEffect(() => {
    const idChanged = idRef.current !== message.id;
    idRef.current = message.id;
    const idle = !sendingRef.current && targetRef.current === confirmedRef.current;
    if (idChanged || idle) {
      targetRef.current = myVote;
      confirmedRef.current = myVote;
    }
  }, [message.id, myVote]);

  // Self-converging sender: one request in flight at a time; when it settles, if the intent changed
  // during the flight, send the latest. On error, roll the optimistic cache write back to the last
  // confirmed vote.
  async function flush() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      while (targetRef.current !== confirmedRef.current) {
        const target = targetRef.current;
        try {
          await setVote(message.id, target as -1 | 0 | 1);
        } catch (error) {
          applyVoteToCaches(queryClient, message.id, confirmedRef.current);
          targetRef.current = confirmedRef.current;
          toast.error(
            error instanceof SheshiError && error.code === "UNAUTH"
              ? sq.errors.auth
              : error instanceof SheshiError && error.code === "RATE_LIMITED"
                ? sq.errors.rateLimited
                : "Vota nuk u ruajt. Provo sërish.",
          );
          return;
        }
        confirmedRef.current = target;
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
    const next = myVote === dir ? 0 : dir; // clicking your current vote clears it
    targetRef.current = next;
    // Optimistic + persisted: update my_vote (colour) and score (by the delta) in every cache holding
    // this message, so the change is instant, survives a refresh, and is consistent across views.
    applyVoteToCaches(queryClient, message.id, next);
    if (next !== 0) setPop((p) => p + 1);
    void flush();
  }

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
        {formatScore(score)}
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

// Set this message's vote to `nextVote` wherever it lives in the React Query cache (the feed's
// InfiniteData, the thread tree, highlights, single-message), adjusting the score by the delta from
// its current vote. Shape-agnostic, immutable, and a no-op where nothing changes (so unrelated
// queries don't re-render). Used for both the optimistic write and the rollback — passing the last
// confirmed vote reverses an optimistic change exactly, because the delta is computed live.
function applyVoteToCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  messageId: string,
  nextVote: number,
) {
  queryClient.setQueriesData({}, (data: unknown) => patchVote(data, messageId, nextVote));
}

function patchVote<T>(data: T, id: string, nextVote: number): T {
  if (Array.isArray(data)) {
    let changed = false;
    const next = data.map((item) => {
      const patched = patchVote(item, id, nextVote);
      if (patched !== item) changed = true;
      return patched;
    });
    return (changed ? next : data) as T;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // A MessageRow is the only cached node with a my_vote field — match on it so we never touch
    // unrelated objects that happen to carry an `id`.
    if (obj.id === id && "my_vote" in obj) {
      const prevVote = (obj.my_vote as number) ?? 0;
      if (prevVote === nextVote) return data;
      return {
        ...obj,
        my_vote: nextVote,
        score: ((obj.score as number) ?? 0) + (nextVote - prevVote),
      } as T;
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const key in obj) {
      const patched = patchVote(obj[key], id, nextVote);
      if (patched !== obj[key]) changed = true;
      next[key] = patched;
    }
    return (changed ? next : data) as T;
  }
  return data;
}
