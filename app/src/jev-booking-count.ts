import { useQuery } from "@tanstack/react-query";
import { useHomePreview } from "./preview";
import { readyClient } from "./ready-client";

/**
 * FLOW-955 (owner, 2026-10-22), FLOW-1272. Jev's bookings waiting in לאישור, for Home's count and for the
 * queue (`list_jev_bookings`): one read under one key, so Home's read serves Review. It holds the rows as
 * the server sent them; the queue parses them with `select` (jev-bookings.ts) and Home only counts them,
 * so Home parses nothing it doesn't show. Every write that refreshes "jev-bookings" refreshes this.
 */
export function jevBookingsKey(preview: string) {
  return ["jev-bookings", preview] as const;
}

export function jevBookingsQueryOptions(preview: string, enabled: boolean) {
  return {
    queryKey: jevBookingsKey(preview),
    enabled: enabled && preview === "off",
    // One query serves Home and Review, so it has one retry setting (a shared query takes the options of the
    // observer that rendered last): none. לאישור waits for this read before its first draw, so a failure ends
    // that wait at once; Home counts a failed read as zero, and the next refresh reads it again.
    retry: false,
    queryFn: async (): Promise<unknown> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("list_jev_bookings");
      if (error) throw error;
      return data;
    },
  };
}

/** Zero in preview, and when the read fails. */
export function useJevBookingCountQuery(enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    ...jevBookingsQueryOptions(preview, enabled),
    select: (data) => (Array.isArray(data) ? data.length : 0),
  });
}

/** Home's לאישור count: the queue's own items and Jev's bookings waiting before them. */
export function reviewWaiting(queued: number, bookings: number | undefined): number {
  return queued + (bookings ?? 0);
}
