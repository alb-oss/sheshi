import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Clock3, Hash, MessageSquare, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { sq as sqLocale } from "date-fns/locale";
import { AppShell } from "@/components/AppShell";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sq } from "@/i18n/sq";
import { useAuth } from "@/hooks/use-auth";
import { apiJson, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ensureRealtimeStarted } from "@/lib/realtime";
import { createRoom, listRooms, type Room } from "@/lib/sheshi";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dhoma — Sheshi" },
      {
        name: "description",
        content: "Dhomat publike të Sheshi për diskutime qytetare të shpejta.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [presence, setPresence] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();

  const roomLookup = useMemo(() => new Map(rooms.map((r) => [r.id, r.slug])), [rooms]);
  const sortedRooms = useMemo(
    () =>
      [...rooms].sort((a, b) => {
        const aTime = a.latest_activity_at ? new Date(a.latest_activity_at).getTime() : 0;
        const bTime = b.latest_activity_at ? new Date(b.latest_activity_at).getTime() : 0;
        return bTime - aTime || a.name.localeCompare(b.name);
      }),
    [rooms],
  );

  const reload = () => {
    setLoading(true);
    Promise.all([
      listRooms(),
      apiJson<Record<string, number>>("/api/rooms/presence").catch(() => ({})),
    ])
      .then(([nextRooms, nextPresence]) => {
        setRooms(nextRooms);
        setPresence(nextPresence);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // Live: per-room presence counts + newly created rooms, without a manual refresh.
    let disposed = false;
    const onPresence = (e: { room_id: string; count: number }) =>
      setPresence((current) => ({ ...current, [e.room_id]: e.count }));
    const onRoomCreated = (room: Room) =>
      setRooms((current) => (current.some((r) => r.id === room.id) ? current : [room, ...current]));
    const conn = ensureRealtimeStarted();
    conn
      .then((c) => {
        if (disposed) return;
        c.on("presence", onPresence);
        c.on("room_created", onRoomCreated);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      conn
        .then((c) => {
          c.off("presence", onPresence);
          c.off("room_created", onRoomCreated);
        })
        .catch(() => {});
    };
  }, []);

  async function onCreateRoom(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const room = await createRoom({
        name,
        description: description.trim() ? description : null,
      });
      setName("");
      setDescription("");
      setCreateOpen(false);
      setRooms((current) => [room, ...current.filter((r) => r.id !== room.id)]);
      await navigate({ to: "/dhoma/$slug", params: { slug: room.slug } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCreateError(sq.errors.auth);
      } else if (error instanceof ApiError && error.status === 409) {
        setCreateError("Kjo dhomë ekziston tashmë.");
      } else {
        setCreateError("Dhoma nuk u krijua. Provo sërish.");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell right={<HighlightsPanel currentUserId={userId} roomSlugLookup={roomLookup} />}>
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-6 py-5 shrink-0">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
                <Hash className="h-3.5 w-3.5" aria-hidden />
                {sq.rooms.title}
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight">Dhoma publike</h1>
              <p className="mt-1 max-w-2xl text-sm text-foreground/55">
                Hyr në një dhomë, hap një temë dhe përgjigju shpejt. Çdo dhomë është publike.
              </p>
            </div>

            {user ? (
              <Button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="rounded-sm font-bold uppercase tracking-widest"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Dhomë e re
              </Button>
            ) : (
              <Button asChild className="rounded-sm font-bold uppercase tracking-widest">
                <Link to="/auth">Hyr për të krijuar</Link>
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 sm:px-6">
          {loading ? (
            <div className="text-xs uppercase tracking-widest font-bold text-foreground/40">
              {sq.chat.loading}
            </div>
          ) : sortedRooms.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-xs uppercase tracking-widest font-bold text-foreground/40">
                {sq.rooms.empty}
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {sortedRooms.map((room) => (
                <RoomCard key={room.id} room={room} activeCount={presence[room.id] ?? 0} />
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-sm border-border bg-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Krijo dhomë</DialogTitle>
            <DialogDescription>
              Dhomat janë publike dhe shfaqen menjëherë në faqen kryesore.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreateRoom} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-foreground/55">
                Emri
              </label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="#transporti"
                maxLength={60}
                className="rounded-sm"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-foreground/55">
                Përshkrimi
              </label>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Për çfarë diskutohet këtu?"
                maxLength={180}
                className="min-h-24 rounded-sm"
              />
            </div>
            {createError ? <p className="text-sm font-medium text-primary">{createError}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                className="rounded-sm"
              >
                Anulo
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || creating}
                className="rounded-sm font-bold uppercase tracking-widest"
              >
                {creating ? "Po krijohet…" : "Krijo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function RoomCard({ room, activeCount }: { room: Room; activeCount: number }) {
  return (
    <Link
      to="/dhoma/$slug"
      params={{ slug: room.slug }}
      className="group flex items-start justify-between gap-5 rounded-sm border border-border bg-card/30 px-4 py-4 transition-colors hover:border-primary/50 hover:bg-card/60"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate font-display text-xl font-bold tracking-tight group-hover:text-primary">
            {room.name}
          </h2>
          {activeCount > 0 ? (
            <span className="inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden />
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-foreground/55">
          {room.description || "Dhomë publike për tema të shpejta."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Metric
            icon={<Users className="h-3.5 w-3.5" aria-hidden />}
            value={activeCount}
            label="live"
            active={activeCount > 0}
          />
          <Metric
            icon={<MessageSquare className="h-3.5 w-3.5" aria-hidden />}
            value={room.thread_count ?? 0}
            label="tema"
          />
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-foreground/35">
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            {formatLatest(room.latest_activity_at)}
          </span>
        </div>
      </div>
      <ArrowUpRight
        className="mt-1 h-4 w-4 shrink-0 text-foreground/20 transition-colors group-hover:text-primary"
        aria-hidden
      />
    </Link>
  );
}

function Metric({
  icon,
  value,
  label,
  active,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest",
        active ? "text-primary" : "text-foreground/45",
      )}
    >
      {icon}
      <span className="tabular-nums">{value}</span>
      {label}
    </span>
  );
}

function formatLatest(value?: string | null) {
  if (!value) return "pa aktivitet";
  try {
    return formatDistanceToNowStrict(new Date(value), {
      locale: sqLocale,
      addSuffix: true,
    });
  } catch {
    return "së fundi";
  }
}
