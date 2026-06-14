import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { useAuth } from "@/hooks/use-auth";
import { useRooms } from "@/hooks/use-rooms";

export const Route = createFileRoute("/fokus")({
  head: () => ({
    meta: [
      { title: "Në Fokus — Sheshi" },
      {
        name: "description",
        content: "Mesazhet më të mbështetura dhe më të diskutuara nga komuniteti.",
      },
    ],
  }),
  component: FokusPage,
});

function FokusPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { data: rooms = [] } = useRooms();

  const roomLookup = useMemo(() => new Map(rooms.map((r) => [r.id, r.slug])), [rooms]);

  return (
    <AppShell>
      <div className="h-[calc(100dvh-3.5rem)]">
        <HighlightsPanel currentUserId={userId} roomSlugLookup={roomLookup} />
      </div>
    </AppShell>
  );
}
