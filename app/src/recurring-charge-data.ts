import type { MissingBill, PaymentRecurring, PartyCharges, RecurringChange } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { useMissingBillsQuery, useRecurringChangesQuery, usePaymentRecurringQuery } from "./forecast";
import { getSupabase } from "./lib/supabase";
import { usePartyChargesQuery } from "./party-charges";
import { useHomePreview } from "./preview";
import { type ScheduleRow, useRecurringScheduleQuery } from "./recurring-schedule";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-447c: the charge page's reads. The party's schedule row, its newest line (the line the page
 * reads: its charges, its pace and its change alert), the late bills and the changes. Every read is
 * the server's; the page draws what they return.
 */

/** The newest counted line of a party in one currency (`recurring_party_line`), or null when there is none. */
export function usePartyLineQuery(direction: "income" | "expense", partyId: string, currency: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["party-line", preview, direction, partyId, currency],
    enabled: active && preview === "off" && currency !== "",
    queryFn: async (): Promise<string | null> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("recurring_party_line", { p_direction: direction, p_party_id: partyId, p_currency: currency });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
  });
}

/** What the page draws, from one read of its party. `missing` is a schedule with no row for the party. */
export type ChargePageData =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | {
      status: "ready";
      row: ScheduleRow;
      bills: MissingBill[] | undefined;
      changes: RecurringChange[] | undefined;
      lineId: string | null;
      charges: PartyCharges | null;
      recurring: PaymentRecurring | null;
    };

/**
 * The charge page's data for one party. The page is ready once the schedule has the party; the line,
 * its charges and its recurring switch fill in behind it. A late bill or change that did not load
 * (undefined) still alerts, so the page never hides an alert it cannot check.
 */
export function useChargePageData(direction: "income" | "expense", partyId: string, enabled = true): ChargePageData {
  const preview = useHomePreview();
  const schedule = useRecurringScheduleQuery(enabled && preview === "off");
  const row = schedule.data?.find((item) => item.party_id === partyId && item.direction === direction);
  const line = usePartyLineQuery(direction, partyId, row?.currency ?? "", row != null);
  const lineId = line.data ?? null;
  const charges = usePartyChargesQuery(lineId ?? "", lineId != null);
  const recurring = usePaymentRecurringQuery(lineId ?? "", lineId != null);
  const bills = useMissingBillsQuery(enabled && row != null);
  const changes = useRecurringChangesQuery(enabled && row != null);
  if (preview !== "off") return preview === "loading" ? { status: "loading" } : { status: "missing" };
  if (schedule.data == null) return schedule.isError ? { status: "error" } : { status: "loading" };
  if (row == null) return { status: "missing" };
  return {
    status: "ready",
    row,
    bills: bills.data,
    changes: changes.data,
    lineId,
    charges: charges.data ?? null,
    recurring: recurring.data ?? null,
  };
}
