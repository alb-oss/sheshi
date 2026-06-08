import { useEffect, useState } from "react";
import { sq } from "@/i18n/sq";
import { listHighlights, type HighlightMode, type MessageRow } from "@/lib/sheshi";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Link } from "@tanstack/react-router";
import { Flame, MessageSquare, ArrowBigUp } from "lucide-react";

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
      .then((r) => { if (!cancelled) setItems(r); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mode, currentUserId]);

  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-4 py-3 flex items-center gap-2">
        <Flame className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">{sq.fokus.title}</h2>
      </div>
      <Tabs value={mode} onValueChange={(v) => setMode(v as HighlightMode)} className="flex-1 flex flex-col">
        <TabsList className="m-3 grid grid-cols-3">
          <TabsTrigger value="hot">{sq.fokus.hot}</TabsTrigger>
          <TabsTrigger value="top">{sq.fokus.top}</TabsTrigger>
          <TabsTrigger value="replied">{sq.fokus.replied}</TabsTrigger>
        </TabsList>
        <TabsContent value={mode} className="flex-1 overflow-y-auto px-3 pb-6 mt-0">
          {loading ? (
            <div className="text-sm text-muted-foreground p-4">{sq.chat.loading}</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4">{sq.fokus.empty}</div>
          ) : (
            <ol className="space-y-2">
              {items.map((m, i) => {
                const slug = roomSlugLookup.get(m.room_id) ?? "sheshi";
                return (
                  <li key={m.id}>
                    <Link
                      to="/r/$slug/t/$messageId"
                      params={{ slug, messageId: m.id }}
                      className="block rounded-md border bg-card p-3 hover:bg-accent transition-colors"
                    >
                      <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                        <span className="font-mono tabular-nums">#{i + 1}</span>
                        <span>{m.author?.display_name || m.author?.username || "Anonim"}</span>
                      </div>
                      <div className="mt-1 line-clamp-3 text-sm">{m.body}</div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><ArrowBigUp className="h-3.5 w-3.5" />{m.upvotes ?? 0}</span>
                        <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{m.reply_count ?? 0}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
