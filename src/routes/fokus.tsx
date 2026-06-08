import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { useAuth } from "@/hooks/use-auth";
import { listRooms, type Room } from "@/lib/sheshi";

export const Route = createFileRoute("/fokus")({
  head: () => ({
    meta: [
      { title: "Në Fokus — Sheshi" },
      { name: "description", content: "Mesazhet më të mbështetura dhe më të diskutuara nga komuniteti." },
    ],
  }),
  component: FokusPage,
});

function FokusPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    listRooms().then(setRooms);
  }, []);

  const roomLookup = useMemo(() => new Map(rooms.map((r) => [r.id, r.slug])), [rooms]);

  return (
    <AppShell>
      <div className="h-[calc(100dvh-3.5rem)]">
        <HighlightsPanel currentUserId={userId} roomSlugLookup={roomLookup} />
      </div>
    </AppShell>
  );
}
