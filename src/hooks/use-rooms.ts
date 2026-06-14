import { useQuery } from "@tanstack/react-query";
import { listRooms } from "@/lib/sheshi";

export const roomsKey = ["rooms"] as const;

// Rooms change rarely yet are read on nearly every page (the sidebar on every route + the home,
// fokus and thread pages). Caching them means one shared request, an instant render on navigation,
// and a quiet background revalidate after 60s — instead of a fresh round-trip each time.
export function useRooms() {
  return useQuery({ queryKey: roomsKey, queryFn: listRooms, staleTime: 60_000 });
}
