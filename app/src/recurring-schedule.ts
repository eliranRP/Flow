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
  /** Decision 0189: owner when the owner set the usual amount; omitted on older payloads. */
  typical_amount_source?: "owner" | "computed";
  /** Complete months behind the usual amount; 0 in the charge's first month seen. Omitted on older payloads. */
  months_seen?: number;
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
 * One recurring charge: a party in one project (decision 0185), so a servicer paying several loans is
 * several charges. The key the list's rows, their alerts and their pages use.
 */
export function chargeKey(row: Pick<ScheduleRow, "direction" | "party_id" | "project_id">): string {
  return `${row.direction}:${row.party_id}:${row.project_id ?? ""}`;
}

/** Whether the party is split into charges by project: another row has its party and direction. */
export function isSplitParty(rows: readonly ScheduleRow[], row: Pick<ScheduleRow, "direction" | "party_id">): boolean {
  return rows.filter((item) => item.direction === row.direction && item.party_id === row.party_id).length > 1;
}

/** A list row's id: the party's, or its chargeKey when the party is split by project. */
export function rowId(rows: readonly ScheduleRow[], row: ScheduleRow): string {
  return isSplitParty(rows, row) ? chargeKey(row) : row.party_id;
}

/**
 * Maps the server rows to the layout's lines: "arrived" rows carry the amount they came at, "due" is
 * any row not later than this month (late and soon as well as arrived), and "later" rows stay out of the total.
 * The server signs an expense negative; the list shows amounts unsigned, so the magnitude is taken here.
 */
export function scheduleLines(rows: readonly ScheduleRow[], all: readonly ScheduleRow[] = rows): RecurringLine[] {
  return rows.map((row) => {
    const arrived = row.state === "arrived";
    const minor = arrived && row.amount_minor != null ? row.amount_minor : row.typical_amount_minor;
    return {
      // Ids come from every row, so a project's view keys a split party's charge as the full list does.
      id: rowId(all, row),
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

/** A late charge that still alerts (by rowId): the key its dismissal takes (null when the read failed), and its match. */
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
    for (const row of late) active.set(rowId(rows, row), { alertKey: null, suggestion: null });
    return { active, dismissed };
  }
  const bills = new Map(missing.filter((bill) => bill.party_id != null).map((bill) => [
    chargeKey({ direction: bill.direction === "income" ? "income" : "expense", party_id: String(bill.party_id), project_id: bill.project_id ?? null }),
    bill,
  ] as const));
  for (const row of late) {
    const id = rowId(rows, row);
    // A party with one charge matches its bill by party; a split party's bill names its project.
    const bill = bills.get(chargeKey(row)) ?? (isSplitParty(rows, row) ? undefined : missing.find((item) => item.party_id === row.party_id && item.direction === row.direction));
    if (bill == null) dismissed.add(id);
    else active.set(id, { alertKey: bill.alert_key ?? null, suggestion: bill.suggestion ?? null });
  }
  return { active, dismissed };
}

function magnitude(minor: number): bigint {
  return BigInt(Math.abs(minor));
}

/** The Israel calendar day as YYYY-MM-DD, the day the server counts lateness from. */
export function israelToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

/** Whole days from one YYYY-MM-DD day to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * The whole percent a charge is off its usual amount, by size: 38 is 38% over, -20 is 20% under.
 * The rounding is the list's (FLOW-447), so the page and the list show the same figure.
 */
export function changePercentOf(minor: bigint, usual: bigint): number {
  return Math.round(Number(((minor - usual) * 10000n) / usual) / 100);
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
