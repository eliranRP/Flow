import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getSupabase } from "./lib/supabase";
import { parseLineJournal } from "./line-journal";
import { useHomePreview } from "./preview";
import { isTransientWriteError, type WriteFailure } from "./use-write";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-955 (board LedgerReviewCard). Jev's bookings waiting in לאישור: an MCP book_line or split_line
 * write that still stands, not undone and not reviewed (`list_jev_bookings`). אישור keeps it
 * (`approve_jev_booking`); ביטול takes it back through MCP undo's own branch (`undo_jev_booking`), and
 * the line returns to its normal assignment.
 */

const bookingSchema = z.object({
  write_id: z.string(),
  transaction_id: z.string(),
  kind: z.enum(["book_line", "line_split"]),
  party: z.string(),
  doc_date: z.string(),
  direction: z.enum(["income", "expense"]),
  amount_gross: z.union([z.number(), z.string()]).transform((value) => BigInt(value)),
  currency: z.string(),
  source: z.string(),
  journal: z.unknown().transform((value) => parseLineJournal(value)),
});

export type JevBooking = z.infer<typeof bookingSchema>;

export function parseJevBookings(data: unknown): JevBooking[] {
  return z.array(bookingSchema).parse(data);
}

export function jevBookingsKey(preview: string) {
  return ["jev-bookings", preview] as const;
}

/** Jev's bookings to review. A viewer reads them too. No read in preview or sample. */
export function useJevBookingsQuery(enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: jevBookingsKey(preview),
    enabled: enabled && preview === "off",
    retry: 1,
    queryFn: async (): Promise<JevBooking[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("list_jev_bookings");
      if (error) throw error;
      return parseJevBookings(data);
    },
  });
}

export const JEV_BOOKING_APPROVED = "הפקודה של Jev אושרה";
export const JEV_BOOKING_UNDONE = "הפקודה של Jev בוטלה. התנועה חזרה לשיוך רגיל.";

/** A refusal is final (the booking moved on); a dropped connection retries. */
export function jevBookingFailure(error: Error): WriteFailure {
  if (/line changed since/i.test(error.message)) return { message: "התנועה השתנתה מאז, ולכן אי אפשר לבטל את הפקודה.", tone: "info", retry: false };
  if (/booking not found/i.test(error.message)) return { message: "הפקודה כבר לא ממתינה לאישור.", tone: "info", retry: false };
  return { message: "לא הצלחנו לשמור.", retry: isTransientWriteError(error) };
}

export type JevBookingApi = {
  approve: (transactionId: string) => Promise<void>;
  undo: (transactionId: string) => Promise<void>;
};

export const liveJevBookingApi: JevBookingApi = {
  approve: async (transactionId) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    const { error } = await supabase.rpc("approve_jev_booking", { p_transaction_id: transactionId });
    if (error) throw new Error(error.message);
  },
  undo: async (transactionId) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    const { error } = await supabase.rpc("undo_jev_booking", { p_transaction_id: transactionId });
    if (error) throw new Error(error.message);
  },
};
