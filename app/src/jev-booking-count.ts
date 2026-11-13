import { useQuery } from "@tanstack/react-query";
import { jevBookingsQueryOptions } from "./jev-bookings";
import { useHomePreview } from "./preview";

/**
 * FLOW-955 (owner, 2026-10-22). How many of Jev's bookings wait in לאישור, for Home's count. It reads the queue's
 * own query (`jevBookingsQueryOptions`, key ["jev-bookings", preview]) and counts it, so a visit to Review after
 * Home finds the list cached. Every write that refreshes "jev-bookings" refreshes this too. Zero in preview, and
 * when the read fails.
 */
export function useJevBookingCountQuery(enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    ...jevBookingsQueryOptions(preview, 1),
    enabled: enabled && preview === "off",
    select: (bookings) => bookings.length,
  });
}

/** Home's לאישור count: the queue's own items and Jev's bookings waiting before them. */
export function reviewWaiting(queued: number, bookings: number | undefined): number {
  return queued + (bookings ?? 0);
}
