import type { RecurringPace } from "@flow/shared";
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
