import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, Flame, User, Radio, Shield, Sun, Moon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getStoredTheme, setTheme, type Theme } from "@/lib/theme";
import { sq } from "@/i18n/sq";
import { signOutLocal, useAuth } from "@/hooks/use-auth";
import { listRooms, type Room } from "@/lib/sheshi";
import { cn } from "@/lib/utils";
import { apiJson, apiNoContent } from "@/lib/api-client";
import { getStoredTokens } from "@/lib/token-store";
import { ensureRealtimeStarted } from "@/lib/realtime";
import { canModerate } from "@/lib/roles";

export function AppShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [presence, setPresence] = useState<Record<string, number>>({});
  const { user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMod = canModerate(user);

  async function handleSignOut() {
    const refreshToken = getStoredTokens()?.refreshToken;
    try {
      if (refreshToken)
        await apiNoContent("/api/auth/logout", { method: "POST", body: { refresh_token: refreshToken } });
    } catch {
      // proceed with local sign-out even if the server session is already gone
    }
    signOutLocal();
    navigate({ to: "/dhoma/$slug", params: { slug: "sheshi" } });
  }

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
    // A new public room appears in every sidebar live (deduped against optimistic inserts).
    const onRoomCreated = (room: Room) => {
      setRooms((current) => (current.some((r) => r.id === room.id) ? current : [...current, room]));
    };
    const connectionPromise = ensureRealtimeStarted();
    connectionPromise
      .then((connection) => {
        if (disposed) return;
        connection.on("presence", onPresence);
        connection.on("room_created", onRoomCreated);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      connectionPromise
        .then((connection) => {
          connection.off("presence", onPresence);
          connection.off("room_created", onRoomCreated);
        })
        .catch(() => {});
    };
  }, []);

  const activeSlug = pathname.startsWith("/dhoma/") ? pathname.split("/")[2] : null;

  return (
    <div className="flex flex-col h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Top header */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
        <Link to="/" className="group flex min-h-10 items-center gap-3">
          <img
            src="/sheshi-icon.png"
            alt="Sheshi"
            width={28}
            height={28}
            className="w-7 h-7 rounded-lg group-hover:scale-110 transition-transform"
          />
          <div className="flex flex-col leading-none">
            <span className="font-display font-bold tracking-tighter text-lg">SHESHI</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/50 mt-0.5">
              Zëri qytetar live
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          {user ? (
            <Link
              to="/profili"
              className="hidden sm:inline-flex h-9 items-center rounded-full px-3 text-xs font-bold uppercase tracking-widest text-foreground/70 transition-colors hover:bg-card hover:text-foreground"
            >
              {sq.nav.profile}
            </Link>
          ) : null}
          {isMod ? (
            <Link
              to="/moderim"
              className="hidden sm:inline-flex h-9 items-center rounded-full px-3 text-xs font-bold uppercase tracking-widest text-foreground/70 transition-colors hover:bg-card hover:text-foreground"
            >
              {sq.nav.admin}
            </Link>
          ) : null}
          {user ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-bold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/85"
            >
              {sq.auth.signOut}
            </button>
          ) : (
            <Link
              to="/auth"
              className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-bold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/85"
            >
              {sq.auth.signIn}
            </Link>
          )}
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
                    to="/dhoma/$slug"
                    params={{ slug: r.slug }}
                    className={cn(
                      "flex items-center justify-between group px-3 py-2 rounded-lg transition-colors",
                      active
                        ? "bg-card text-primary font-semibold"
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

        {/* Center. overflow-y-auto so pages that don't manage their own scroll (moderim,
            profili, fokus) can scroll; room/thread fill h-full and scroll internally. */}
        <main className="flex-1 min-w-0 flex flex-col overflow-y-auto bg-background">{children}</main>

        {/* Right column */}
        {right && (
          <aside className="hidden lg:flex w-80 border-l border-border bg-background flex-col shrink-0">
            {right}
          </aside>
        )}
      </div>

      {/* Mobile bottom nav — a real flex child (not fixed) so the docked composer sits above it. */}
      <nav className="shrink-0 md:hidden border-t border-border bg-background">
        <div className={cn("grid h-16", isMod ? "grid-cols-5" : "grid-cols-4")}>
          <BottomLink
            to="/"
            icon={<Home className="h-5 w-5" />}
            label={sq.nav.rooms}
            active={pathname === "/" || pathname.startsWith("/dhoma/") || pathname.startsWith("/tema/")}
          />
          <BottomLink
            to="/dhoma/sheshi"
            icon={<Radio className="h-5 w-5" />}
            label={sq.nav.live}
            active={pathname === "/dhoma/sheshi"}
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

function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => setThemeState(getStoredTheme()), []);
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      aria-label={isDark ? "Kalo në temë të çelët" : "Kalo në temë të errët"}
      title={isDark ? "Temë e çelët" : "Temë e errët"}
      onClick={() => {
        const next: Theme = isDark ? "light" : "dark";
        setTheme(next);
        setThemeState(next);
      }}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-card hover:text-foreground"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
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
