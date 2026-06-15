import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { listRoomMedia, type MediaItem } from "@/lib/sheshi";

// Full-screen swipeable gallery over ALL of a room's media (WhatsApp-style). Opens instantly on the
// tapped item (`fallback`) and, once the room's media list loads, jumps to that item's index so you can
// swipe across media that are far apart in the feed. Swipe (touch) / ← → (keys) / on-screen arrows.
export function MediaViewer({
  roomId,
  focusMessageId,
  fallback,
  onClose,
}: {
  roomId: string;
  focusMessageId: string;
  fallback: MediaItem;
  onClose: () => void;
}) {
  const { data: media = [] } = useQuery({
    queryKey: ["room-media", roomId],
    queryFn: () => listRoomMedia(roomId),
    staleTime: 30_000,
  });
  // `fallback` is only the pre-load placeholder; once the room media loads it's ignored.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo<MediaItem[]>(() => (media.length ? media : [fallback]), [media]);
  const [index, setIndex] = useState(0);

  // Jump to the tapped item once the full gallery arrives.
  useEffect(() => {
    if (!media.length) return;
    const i = media.findIndex((m) => m.message_id === focusMessageId);
    setIndex(i >= 0 ? i : 0);
  }, [media, focusMessageId]);

  const last = items.length - 1;
  const current = items[Math.min(index, last)];
  const go = (delta: number) => setIndex((i) => Math.max(0, Math.min(last, i + delta)));

  // Keyboard: Escape closes, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, onClose]);

  // Preload neighbouring images so a swipe is instant.
  useEffect(() => {
    [index - 1, index + 1].forEach((i) => {
      const m = items[i];
      if (m?.kind === "image") {
        const img = new Image();
        img.src = m.url;
      }
    });
  }, [index, items]);

  const touchX = useRef<number | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      role="dialog"
      aria-modal="true"
      // Stop propagation: this overlay is a React child of the message <article>, which navigates on
      // click — without this, tapping the backdrop would also open the thread.
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <div
        className="flex h-full w-full items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {current.kind === "image" ? (
          <img src={current.url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <video
            key={current.url}
            src={current.url}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full"
          />
        )}
      </div>

      {items.length > 1 && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-bold tabular-nums text-white">
          {Math.min(index, last) + 1} / {items.length}
        </div>
      )}
      {current.author ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
          {current.author}
        </div>
      ) : null}

      {index > 0 ? (
        <button
          type="button"
          aria-label="Mëparshëm"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          className="absolute left-2 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-black/40 p-2 text-white transition-colors hover:bg-black/60 sm:inline-flex"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      ) : null}
      {index < last ? (
        <button
          type="button"
          aria-label="Tjetër"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-black/40 p-2 text-white transition-colors hover:bg-black/60 sm:inline-flex"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      ) : null}

      <button
        type="button"
        aria-label="Mbyll"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
