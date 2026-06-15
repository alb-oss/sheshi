import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getApiBaseUrl } from "@/lib/api-client";

const FALLBACK_ORIGIN = "https://sheshi.live";

function escapeXml(value: string) {
  return value.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

// Dynamic sitemap: absolute URLs (Google rejects relative ones) covering the static pages, every public
// room, and the currently-hot threads — so the actual content is discoverable, not just the 4 landing
// pages. Runs server-side; never throws (a failed API fetch degrades to the static paths).
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const host = request.headers.get("host");
        const origin = host ? `https://${host}` : FALLBACK_ORIGIN;
        const api = getApiBaseUrl();
        const fetchJson = async (path: string): Promise<unknown[]> => {
          try {
            const res = await fetch(`${api}${path}`, { headers: { Accept: "application/json" } });
            return res.ok ? ((await res.json()) as unknown[]) : [];
          } catch {
            return [];
          }
        };

        const [rooms, hot] = await Promise.all([
          fetchJson("/api/rooms"),
          fetchJson("/api/highlights?mode=top"),
        ]);

        // Public, indexable paths only (no /auth). A Set dedupes overlaps.
        const paths = new Set<string>(["/", "/fokus"]);
        for (const r of rooms as { slug?: string }[]) if (r?.slug) paths.add(`/dhoma/${r.slug}`);
        for (const m of hot as { id?: string }[]) if (m?.id) paths.add(`/tema/${m.id}`);

        const urls = [...paths]
          .map(
            (p) =>
              `  <url><loc>${escapeXml(origin + p)}</loc><changefreq>hourly</changefreq></url>`,
          )
          .join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
