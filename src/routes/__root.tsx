import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { persistOptions } from "@/lib/query-persist";
import { Toaster } from "@/components/ui/sonner";
import { subscribeTokenStore } from "@/lib/token-store";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Faqja nuk u gjet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Faqja që po kërkoni nuk ekziston ose është lëvizur.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Kthehu në sheshi
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Diçka shkoi keq</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Provoni të rifreskoni faqen ose kthehuni në sheshi.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Provo sërish
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground"
          >
            Sheshi
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Sheshi — Zëri qytetar i Shqipërisë" },
      {
        name: "description",
        content:
          "Sheshi është chat-i qytetar live për shqiptarët — diskuto, mbështet dhe vër në fokus mesazhet që kanë rëndësi.",
      },
      { name: "author", content: "Sheshi" },
      { property: "og:title", content: "Sheshi — Zëri qytetar i Shqipërisë" },
      {
        property: "og:description",
        content:
          "Sheshi është chat-i qytetar live për shqiptarët — diskuto, mbështet dhe vër në fokus mesazhet që kanë rëndësi.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/sheshi-icon.png" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:image", content: "/sheshi-icon.png" },
      { name: "twitter:title", content: "Sheshi — Zëri qytetar i Shqipërisë" },
      {
        name: "twitter:description",
        content:
          "Sheshi është chat-i qytetar live për shqiptarët — diskuto, mbështet dhe vër në fokus mesazhet që kanë rëndësi.",
      },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800;900&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="sq" className="dark">
      <head>
        {/* Apply the stored theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    return subscribeTokenStore(() => {
      router.invalidate();
    });
  }, [router]);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <Outlet />
      <Toaster richColors position="top-center" />
    </PersistQueryClientProvider>
  );
}
