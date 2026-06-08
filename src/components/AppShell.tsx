import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Flame, User, Radio, Shield } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { sq } from "@/i18n/sq";
import { useAuth } from "@/hooks/use-auth";
import { listRooms, type Room } from "@/lib/sheshi";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api-client";
import { ensureRealtimeStarted } from "@/lib/realtime";

export function AppShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [presence, setPresence] = useState<Record<string, number>>({});
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMod = !!user?.roles?.some((role) => role === "moderator" || role === "admin");

  useEffect(() => {
    listRooms()
      .then(setRooms)
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiJson<Record<string, number>>("/api/rooms/presence")
      .then(setPresence)
      .catch(() => {});
    let disposed = false;
    const onPresence = (event: { room_id: string; count: number }) => {
      setPresence((current) => ({ ...current, [event.room_id]: event.count }));
    };
    const connectionPromise = ensureRealtimeStarted();
    connectionPromise
      .then((connection) => {
        if (disposed) return;
        connection.on("presence", onPresence);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      connectionPromise
        .then((connection) => connection.off("presence", onPresence))
        .catch(() => {});
    };
  }, []);

  const activeSlug = pathname.startsWith("/r/") ? pathname.split("/")[2] : null;

  return (
    <div className="flex flex-col h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Top header */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
        <Link to="/" className="flex items-center gap-3 group">
          <div
            className="w-6 h-6 bg-primary rounded-sm group-hover:scale-110 transition-transform"
            aria-hidden
          />
          <div className="flex flex-col leading-none">
            <span className="font-display font-bold tracking-tighter text-lg">SHESHI</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/50 mt-0.5">
              Zëri qytetar live
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          {user ? (
            <Link
              to="/profili"
              className="text-xs uppercase tracking-widest font-bold text-foreground/70 hover:text-foreground transition-colors"
            >
              {sq.nav.profile}
            </Link>
          ) : null}
          {isMod ? (
            <Link
              to="/moderim"
              className="text-xs uppercase tracking-widest font-bold text-foreground/70 hover:text-foreground transition-colors"
            >
              {sq.nav.admin}
            </Link>
          ) : null}
          <Link
            to={user ? "/profili" : "/auth"}
            className="px-4 py-1.5 bg-primary text-primary-foreground text-sm font-bold uppercase tracking-wide hover:bg-primary/85 transition-colors rounded-sm"
          >
            {user ? sq.auth.signOut : sq.auth.signIn}
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="hidden md:flex w-64 border-r border-border flex-col shrink-0 overflow-y-auto no-scrollbar">
          <div className="p-4">
            <h3 className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.2em] mb-4">
              {sq.rooms.title}
            </h3>
            <nav className="space-y-1">
              {rooms.map((r) => {
                const active = activeSlug === r.slug;
                const count = presence[r.id] ?? 0;
                return (
                  <Link
                    key={r.id}
                    to="/r/$slug"
                    params={{ slug: r.slug }}
                    className={cn(
                      "flex items-center justify-between group px-2 py-1.5 rounded-sm transition-colors",
                      active
                        ? "bg-card text-primary border-l-2 border-primary font-medium"
                        : "text-foreground/70 hover:bg-card/50 hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {active && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
                          aria-hidden
                        />
                      )}
                      {count > 0 && (
                        <span className="text-[10px] tabular-nums text-foreground/30">{count}</span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Center */}
        <main className="flex-1 min-w-0 flex flex-col bg-background pb-16 md:pb-0">{children}</main>

        {/* Right column */}
        {right && (
          <aside className="hidden lg:flex w-80 border-l border-border bg-background flex-col shrink-0">
            {right}
          </aside>
        )}
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-border bg-background">
        <div className={cn("grid h-16", isMod ? "grid-cols-5" : "grid-cols-4")}>
          <BottomLink
            to="/"
            icon={<Home className="h-5 w-5" />}
            label={sq.nav.rooms}
            active={pathname === "/" || (pathname.startsWith("/r/") && !pathname.includes("/t/"))}
          />
          <BottomLink
            to="/r/sheshi"
            icon={<Radio className="h-5 w-5" />}
            label={sq.nav.live}
            active={pathname === "/r/sheshi"}
          />
          <BottomLink
            to="/fokus"
            icon={<Flame className="h-5 w-5" />}
            label={sq.nav.fokus}
            active={pathname === "/fokus"}
          />
          <BottomLink
            to="/profili"
            icon={<User className="h-5 w-5" />}
            label={sq.nav.profile}
            active={pathname === "/profili"}
          />
          {isMod ? (
            <BottomLink
              to="/moderim"
              icon={<Shield className="h-5 w-5" />}
              label={sq.nav.admin}
              active={pathname === "/moderim"}
            />
          ) : null}
        </div>
      </nav>
    </div>
  );
}

function BottomLink({
  to,
  icon,
  label,
  active,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-widest font-bold transition-colors",
        active ? "text-primary" : "text-foreground/40 hover:text-foreground/70",
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
