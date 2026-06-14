import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { MessageCard } from "@/components/MessageCard";
import { sq } from "@/i18n/sq";
import { useAuth } from "@/hooks/use-auth";
import { getMessage, type MessageRow } from "@/lib/sheshi";
import { onSavedChanged, savedIds } from "@/lib/saved";

export const Route = createFileRoute("/te-ruajtura")({
  head: () => ({ meta: [{ title: "Të ruajtura — Sheshi" }] }),
  component: SavedPage,
});

// Saved posts live client-side (localStorage ids); resolve each to its current message so the
// list reflects edits/deletes, and drop cards the moment they're unsaved (here or elsewhere).
function SavedPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [posts, setPosts] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const ids = savedIds();
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    Promise.all(ids.map((id) => getMessage(id).catch(() => null)))
      .then((rows) => {
        if (alive) setPosts(rows.filter((r): r is MessageRow => r !== null));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () =>
      onSavedChanged(() => {
        const ids = new Set(savedIds());
        setPosts((prev) => prev.filter((p) => ids.has(p.id)));
      }),
    [],
  );

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        <h1 className="font-display text-2xl font-bold tracking-tight">{sq.nav.saved}</h1>

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground">{sq.chat.loading}</p>
        ) : posts.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-10 text-center">
            <Bookmark className="h-8 w-8 text-foreground/30" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Asnjë postim i ruajtur ende. Prek <span className="font-semibold">{sq.chat.save}</span> te
              një postim për ta gjetur këtu më vonë.
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/30">
            {posts.map((m) => (
              <MessageCard key={m.id} message={m} roomSlug="sheshi" currentUserId={userId} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
