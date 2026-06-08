import { useEffect, useState } from "react";
import { sq } from "@/i18n/sq";
import { listHighlights, type HighlightMode, type MessageRow } from "@/lib/sheshi";
import { Link } from "@tanstack/react-router";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

export function HighlightsPanel({
  currentUserId,
  roomSlugLookup,
}: {
  currentUserId: string | null;
  roomSlugLookup: Map<string, string>;
}) {
  const [mode, setMode] = useState<HighlightMode>("hot");
  const [items, setItems] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listHighlights(mode, currentUserId)
      .then((r) => {
        if (!cancelled) setItems(r);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, currentUserId]);

  const tabs: { id: HighlightMode; label: string }[] = [
    { id: "hot", label: sq.fokus.hot },
    { id: "top", label: sq.fokus.top },
    { id: "replied", label: sq.fokus.replied },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 flex items-center gap-2 border-b border-border">
        <Flame className="w-4 h-4 text-primary" aria-hidden />
        <h3 className="font-display font-bold tracking-tight uppercase text-xs">
          {sq.fokus.title}
        </h3>
      </div>

      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMode(t.id)}
            className={cn(
              "flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors",
              mode === t.id
                ? "text-primary border-b-2 border-primary"
                : "text-foreground/40 hover:text-foreground/70",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="text-xs text-foreground/40 uppercase tracking-widest font-bold">
            {sq.chat.loading}
          </div>
        ) : items.length === 0 ? (
          <div className="text-xs text-foreground/40">{sq.fokus.empty}</div>
        ) : (
          items.map((m, i) => {
            const slug = roomSlugLookup.get(m.room_id) ?? "sheshi";
            return (
              <Link
                key={m.id}
                to="/r/$slug/t/$messageId"
                params={{ slug, messageId: m.id }}
                className="group cursor-pointer block"
              >
                <div className="flex gap-3">
                  <span
                    className="font-display text-2xl font-bold leading-none text-stroke"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <div className="space-y-1 min-w-0 flex-1">
                    <p className="text-xs font-bold leading-tight group-hover:text-primary transition-colors line-clamp-3">
                      {m.body}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-foreground/40">
                      <span className="text-primary font-bold">#{slug}</span>
                      <span aria-hidden>•</span>
                      <span className="tabular-nums">
                        {m.upvotes ?? 0} {(m.upvotes ?? 0) === 1 ? "votë" : "vota"}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
