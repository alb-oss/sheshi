import { useEffect, useState } from "react";
import { useIsRestoring, useQuery, useQueryClient } from "@tanstack/react-query";
import { sq } from "@/i18n/sq";
import { listHighlights, type HighlightMode } from "@/lib/sheshi";
import { ensureRealtimeStarted } from "@/lib/realtime";
import { useRealtimeResync } from "@/hooks/use-realtime-resync";
import { Link } from "@tanstack/react-router";
import { Flame, ArrowUp, MessageSquare, ArrowUpRight } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { sq as sqLocale } from "date-fns/locale";
import { cn } from "@/lib/utils";

export function HighlightsPanel({
  currentUserId,
  roomSlugLookup,
}: {
  currentUserId: string | null;
  roomSlugLookup: Map<string, string>;
}) {
  const [mode, setMode] = useState<HighlightMode>("hot");
  const queryClient = useQueryClient();
  // Highlights come from the PERSISTED cache; keep the skeleton on the server and the first client render
  // (while the cache restores) so the panel doesn't pop restored items and trip React 19 hydration.
  const isRestoring = useIsRestoring();
  const { data: items = [], isPending } = useQuery({
    queryKey: ["highlights", mode, currentUserId],
    queryFn: () => listHighlights(mode),
    staleTime: 30_000,
  });
  const loading = isPending || isRestoring;

  // Re-converge to server truth after a reconnect or tab-foreground (the panel listens to the global
  // highlights tick, which is fire-and-forget like every other realtime signal).
  useRealtimeResync(() => void queryClient.invalidateQueries({ queryKey: ["highlights"] }));

  // Keep the panel live — a debounced cache invalidation on any realtime highlights activity
  // (the panel is joined to no room/thread group, so it listens for the global tick).
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed) void queryClient.invalidateQueries({ queryKey: ["highlights"] });
      }, 800);
    };
    const conn = ensureRealtimeStarted();
    conn.then((c) => !disposed && c.on("highlights_changed", tick)).catch(() => {});
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      conn.then((c) => c.off("highlights_changed", tick)).catch(() => {});
    };
  }, [queryClient]);

  const tabs: { id: HighlightMode; label: string }[] = [
    { id: "hot", label: sq.fokus.hot },
    { id: "top", label: sq.fokus.top },
    { id: "replied", label: sq.fokus.replied },
  ];

  const timeAgo = (iso: string) => {
    try {
      return formatDistanceToNowStrict(new Date(iso), { locale: sqLocale, addSuffix: false });
    } catch {
      return "";
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-primary" aria-hidden />
            <h3 className="font-display font-bold tracking-tight uppercase text-sm">
              {sq.fokus.title}
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
            <span className="text-[9px] uppercase tracking-widest font-bold text-foreground/40">
              Auto
            </span>
          </div>
        </div>
        <p className="text-[11px] text-foreground/40 leading-relaxed">
          Më të rëndësishmet sipas votave dhe diskutimit.
        </p>
      </div>

      {/* Segmented tabs */}
      <div className="px-3 pt-3">
        <div className="grid grid-cols-3 bg-card border border-border rounded-sm p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMode(t.id)}
              className={cn(
                "py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all rounded-[2px]",
                mode === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/50 hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content list */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-3">
        {loading ? (
          <div className="space-y-3 px-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-6 h-6 bg-card rounded-sm" />
                <div className="flex-1 space-y-2">
                  <div className="h-2.5 w-full bg-card rounded-sm" />
                  <div className="h-2.5 w-2/3 bg-card rounded-sm" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <div className="text-[10px] uppercase tracking-widest font-bold text-foreground/30 mb-1">
              Asgjë ende
            </div>
            <div className="text-xs text-foreground/50">{sq.fokus.empty}</div>
          </div>
        ) : (
          <ol className="space-y-1">
            {items.map((m, i) => {
              const slug = roomSlugLookup.get(m.room_id) ?? "sheshi";
              const rank = i + 1;
              const topThree = rank <= 3;
              return (
                <li key={m.id}>
                  <Link
                    to="/tema/$messageId"
                    params={{ messageId: m.id }}
                    className="group relative block rounded-sm px-2.5 py-2.5 hover:bg-card transition-colors"
                  >
                    <div className="flex gap-3">
                      <span
                        className={cn(
                          "font-display font-bold leading-none tabular-nums shrink-0 w-6 text-center pt-0.5",
                          topThree ? "text-primary text-xl" : "text-foreground/30 text-sm",
                        )}
                        aria-hidden
                      >
                        {rank.toString().padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium leading-snug text-foreground/90 group-hover:text-foreground line-clamp-3">
                          {m.body}
                        </p>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-primary border border-primary/30 bg-primary/5 px-1.5 py-0.5 rounded-sm">
                            #{slug}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] tabular-nums font-bold text-foreground/60">
                            <ArrowUp className="w-3 h-3" />
                            {m.score ?? 0}
                          </span>
                          {(m.reply_count ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] tabular-nums font-bold text-foreground/60">
                              <MessageSquare className="w-3 h-3" />
                              {m.reply_count}
                            </span>
                          )}
                          <span className="text-[10px] text-foreground/30 tabular-nums ml-auto">
                            {timeAgo(m.created_at)}
                          </span>
                        </div>
                      </div>
                      <ArrowUpRight
                        className="w-3.5 h-3.5 text-foreground/0 group-hover:text-primary transition-colors shrink-0 mt-1"
                        aria-hidden
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Footer link */}
      <div className="border-t border-border px-5 py-3">
        <Link
          to="/fokus"
          className="flex items-center justify-between text-[10px] uppercase tracking-widest font-bold text-foreground/50 hover:text-primary transition-colors"
        >
          <span>Shiko të gjitha</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
