import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Flame, User, Radio } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { sq } from "@/i18n/sq";
import { supabase } from "@/integrations/supabase/client";
import { listRooms, type Room } from "@/lib/sheshi";
import { cn } from "@/lib/utils";

export function AppShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    listRooms().then(setRooms).catch(() => {});
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const activeSlug = pathname.startsWith("/r/") ? pathname.split("/")[2] : null;

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="inline-block h-6 w-6 rounded-sm bg-primary" aria-hidden />
            <span className="font-bold tracking-tight text-lg">{sq.appName}</span>
          </Link>
          <div className="text-sm">
            {user ? (
              <Link to="/profili" className="text-muted-foreground hover:text-foreground">
                {sq.nav.profile}
              </Link>
            ) : (
              <Link to="/auth" className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground font-medium">
                {sq.auth.signIn}
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1">
        {/* Desktop left: rooms */}
        <aside className="hidden md:flex w-56 shrink-0 flex-col border-r p-3 gap-1">
          <div className="px-2 pt-2 pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {sq.rooms.title}
          </div>
          {rooms.map((r) => (
            <Link
              key={r.id}
              to="/r/$slug"
              params={{ slug: r.slug }}
              className={cn(
                "rounded-md px-3 py-2 text-sm hover:bg-accent",
                activeSlug === r.slug && "bg-accent text-accent-foreground font-medium",
              )}
            >
              {r.name}
            </Link>
          ))}
        </aside>

        {/* Center */}
        <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>

        {/* Desktop right: highlights */}
        {right && <aside className="hidden lg:block w-80 shrink-0 border-l">{right}</aside>}
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t bg-background">
        <div className="grid grid-cols-4 h-16">
          <BottomLink to="/" icon={<Home className="h-5 w-5" />} label={sq.nav.rooms} active={pathname === "/" || pathname.startsWith("/r/")} />
          <BottomLink to="/r/sheshi" icon={<Radio className="h-5 w-5" />} label={sq.nav.live} active={pathname === "/r/sheshi"} />
          <BottomLink to="/fokus" icon={<Flame className="h-5 w-5" />} label={sq.nav.fokus} active={pathname === "/fokus"} />
          <BottomLink to="/profili" icon={<User className="h-5 w-5" />} label={sq.nav.profile} active={pathname === "/profili"} />
        </div>
      </nav>
    </div>
  );
}

function BottomLink({ to, icon, label, active }: { to: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-col items-center justify-center gap-1 text-xs",
        active ? "text-primary font-medium" : "text-muted-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
