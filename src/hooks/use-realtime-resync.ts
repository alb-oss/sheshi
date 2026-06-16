import { useEffect, useRef } from "react";
import { onRealtimeReconnected } from "@/lib/realtime";

// Re-sync a view to the server's truth at the two moments a fire-and-forget realtime stream may have
// missed deltas: after a reconnect (the socket was down), and when the tab returns to the foreground (a
// backgrounded/suspended tab missed events). Pass a `resync` callback — typically a query invalidation.
// The latest callback is always used (held in a ref), so callers don't need to memoise it.
export function useRealtimeResync(resync: () => void) {
  const ref = useRef(resync);
  ref.current = resync;

  useEffect(() => {
    const fire = () => ref.current();
    const offReconnected = onRealtimeReconnected(fire);
    const onVisible = () => {
      if (document.visibilityState === "visible") fire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      offReconnected();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
