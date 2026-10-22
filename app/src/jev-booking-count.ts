import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-955 (owner, 2026-10-22). How many of Jev's bookings wait in לאישור, for Home's count. The same read
 * as the queue (`list_jev_bookings`) under its own key, so Home parses nothing it doesn't show; every
 * write that refreshes "jev-bookings" refreshes this too. Zero in preview, and when the read fails.
 */
export function useJevBookingCountQuery(enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["jev-bookings", preview, "count"],
    enabled: enabled && preview === "off",
    retry: 1,
    queryFn: async (): Promise<number> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("list_jev_bookings");
      if (error) throw error;
      return Array.isArray(data) ? data.length : 0;
    },
  });
}

/** Home's לאישור count: the queue's own items and Jev's bookings waiting before them. */
export function reviewWaiting(queued: number, bookings: number | undefined): number {
  return queued + (bookings ?? 0);
}
