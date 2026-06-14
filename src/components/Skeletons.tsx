import { cn } from "@/lib/utils";
import { Skeleton } from "./ui/skeleton";

// Content-shaped loading placeholders that mirror the real components (MessageCard, RoomCard) so the
// layout doesn't jump when data arrives. Body-line widths are cycled deterministically per row, so
// each row looks a little different without re-randomizing on every render (SSR-safe).
const BODY_LINES = [["88%", "52%"], ["70%"], ["94%", "40%"], ["64%", "80%"], ["48%"], ["82%", "60%"]];

export function MessageSkeleton({ index = 0, compact }: { index?: number; compact?: boolean }) {
  const lines = BODY_LINES[index % BODY_LINES.length];
  return (
    <div className="flex gap-2.5 px-3 py-2.5 sm:px-4">
      <Skeleton className={cn("shrink-0 rounded-full", compact ? "h-7 w-7" : "h-9 w-9")} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-9" />
        </div>
        {lines.map((w, i) => (
          <Skeleton key={i} className="h-3.5" style={{ width: w }} />
        ))}
        <div className="flex items-center gap-2 pt-0.5">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-7 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// Matches the feed's divide-y stream of message cards.
export function MessageListSkeleton({ count = 7, compact }: { count?: number; compact?: boolean }) {
  return (
    <div className="flex flex-col divide-y divide-border/40 py-1">
      {Array.from({ length: count }).map((_, i) => (
        <MessageSkeleton key={i} index={i} compact={compact} />
      ))}
    </div>
  );
}

// A thread page: the root post, the "N replies" divider, then a few replies.
export function ThreadSkeleton() {
  return (
    <>
      <MessageSkeleton index={2} />
      <div className="border-y border-border bg-card/40 px-6 py-2.5">
        <Skeleton className="h-2.5 w-20" />
      </div>
      <MessageListSkeleton count={4} compact />
    </>
  );
}

// Mirrors RoomCard on the home page.
export function RoomCardSkeleton() {
  return (
    <div className="rounded-sm border border-border bg-card/30 px-4 py-4">
      <Skeleton className="h-6 w-36" />
      <Skeleton className="mt-2.5 h-3.5 w-3/4" />
      <div className="mt-3.5 flex gap-3">
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3.5 w-16" />
      </div>
    </div>
  );
}

export function RoomListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <RoomCardSkeleton key={i} />
      ))}
    </div>
  );
}
