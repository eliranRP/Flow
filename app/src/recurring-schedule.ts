import type { MissingBill, RecurringPace } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import type { RecurringLine } from "./recurring-layout";
import { waitForAccessToken } from "./wait-for-session";

/** One row of `recurring_schedule` (FLOW-447): a recurring party with its state this month. */
export type ScheduleRow = {
  direction: "income" | "expense";
  party_id: string;
  party_name: string;
  currency: string;
  state: "arrived" | "late" | "soon" | "later";
  typical_amount_minor: number;
  /** This month's live lines, only once the charge has arrived. */
  amount_minor: number | null;
  typical_day: number;
  pace: RecurringPace;
  next_due_month: string;
  expected_by: string;
  project_id: string | null;
  project_name: string | null;
  category_id: string | null;
  category_name: string | null;
};

/**
 * Maps the server rows to the layout's lines: "arrived" rows carry the amount they came at, "due" is
 * any row not later than this month (late and soon as well as arrived), and "later" rows stay out of the total.
 * The server signs an expense negative; the list shows amounts unsigned, so the magnitude is taken here.
 */
export function scheduleLines(rows: readonly ScheduleRow[]): RecurringLine[] {
  return rows.map((row) => {
    const arrived = row.state === "arrived";
    const minor = arrived && row.amount_minor != null ? row.amount_minor : row.typical_amount_minor;
    return {
      id: row.party_id,
      income: row.direction === "income",
      category: row.category_name,
      pace: row.pace,
      usual: magnitude(row.typical_amount_minor),
      minor: magnitude(minor),
      arrived,
      due: row.state !== "later",
      day: row.typical_day,
    };
  });
}

/** The suggestion `missing_bills` carries for a late bill (decision 0179): a party that may be this one. */
export type RecurringSuggestion = NonNullable<MissingBill["suggestion"]>;

/** A late charge that still alerts: the key its dismissal takes (null when the read failed), and its match. */
export type RecurringAlert = { alertKey: string | null; suggestion: RecurringSuggestion | null };

/**
 * FLOW-447b: which late charges still alert. `missing_bills` holds the late bills the user has not
 * dismissed, so a late row found there is active and a late row missing from it is dismissed.
 * With no missing data (the read failed or is loading) every late row stays active with no key,
 * so an error never hides an alert.
 */
export function alertState(rows: readonly ScheduleRow[], missing: readonly MissingBill[] | undefined): { active: Map<string, RecurringAlert>; dismissed: Set<string> } {
  const active = new Map<string, RecurringAlert>();
  const dismissed = new Set<string>();
  const late = rows.filter((row) => row.state === "late");
  if (missing === undefined) {
    for (const row of late) active.set(row.party_id, { alertKey: null, suggestion: null });
    return { active, dismissed };
  }
  const bills = new Map(missing.filter((bill) => bill.party_id != null).map((bill) => [`${String(bill.direction)}:${String(bill.party_id)}`, bill] as const));
  for (const row of late) {
    const bill = bills.get(`${row.direction}:${row.party_id}`);
    if (bill == null) dismissed.add(row.party_id);
    else active.set(row.party_id, { alertKey: bill.alert_key ?? null, suggestion: bill.suggestion ?? null });
  }
  return { active, dismissed };
}

function magnitude(minor: number): bigint {
  return BigInt(Math.abs(minor));
}

/** The schedule of the signed-in company, in the server's order (arrived, late, soon, later). */
export function useRecurringScheduleQuery(enabled = true) {
  return useQuery({
    queryKey: ["recurring-schedule"],
    enabled,
    queryFn: async (): Promise<ScheduleRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("recurring_schedule", {});
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("recurring_schedule");
      return data as ScheduleRow[];
    },
  });
}
