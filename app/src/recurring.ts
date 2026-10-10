import { formatAmountText, type MissingBill, type RecurringChange, type RecurringPace } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { abs, partyName } from "./forecast";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import { searchHref } from "./search";
import { PACE_LABEL } from "./ui/charge-switches";
import { formatDayMonth } from "./ui/date-math";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-415 (b-2): the קבועים screen's own reads and views, apart from forecast.ts so Home's entry
 * does not carry them (the screen loads on demand).
 */

/** One row of the "לא הגיעו" section. */
export type MissingBillView = {
  id: string;
  name: string;
  /** FLOW-415 (b-2): late income (a customer) rather than a late bill. */
  income: boolean;
  /** FLOW-415: "project · category" when the bill files to one; null when neither is known. */
  place: string | null;
  /** FLOW-415: "כל חודש ב־2 · אחרון 02/09". */
  usual: string;
  /** The typical amount, unsigned. */
  minor: bigint;
  currency: string;
  /** Search, filtered to this party on its side. */
  href: string;
  /** FLOW-415 (owner, 08:41Z): the key that hides this row for this user; null on an older server. */
  alertKey: string | null;
  /** FLOW-430: a supplier that may be this one under another name, for the user to answer. */
  match: MissingBillMatch | null;
};

/** FLOW-430 (decision 0178): the pair `answer_recurring_match` takes, and the hint's words. */
export type MissingBillMatch = {
  direction: "expense" | "income";
  partyId: string;
  matchPartyId: string;
  /** The suggested name. */
  name: string;
  /** Its newest line's amount, "$57.79", and date, "06/10". */
  amount: string;
  date: string;
};

/** FLOW-430: the suggestion's hint and pair, or null when the row has none (or an older server). */
export function missingBillMatch(row: MissingBill, now = new Date()): MissingBillMatch | null {
  const found = row.suggestion;
  if (found == null || row.party_id == null) return null;
  const name = found.party_name === "" ? "ללא שם" : found.party_name;
  return {
    direction: row.direction ?? "expense",
    partyId: row.party_id,
    matchPartyId: found.party_id,
    name,
    amount: formatAmountText(abs(found.amount_minor), row.currency, { detail: true }),
    date: formatDayMonth(found.doc_date, now),
  };
}

/** Search with the party's name typed and its side set, keeping the preview flag. */
export function missingBillHref(name: string, search: string, income = false): string {
  return searchHref(name, search, { dir: income ? "income" : "expense" });
}

/** FLOW-415: the pace and day a recurring charge comes ("כל חודש ב־2"), and when the last one came. */
export function usualDayText(typicalDay: number, lastDocDate: string | null | undefined, now = new Date(), pace: RecurringPace = "month"): string {
  const day = `${PACE_LABEL[pace]} ב־${String(typicalDay)}`;
  return lastDocDate == null ? day : `${day} · אחרון ${formatDayMonth(lastDocDate, now)}`;
}

/** FLOW-415: "project · category", either half alone, or null (decision 0172 sends the names). */
export function missingBillPlace(row: Pick<MissingBill, "project_name" | "category_name">): string | null {
  const parts = [row.project_name, row.category_name].filter((part): part is string => part != null && part !== "");
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function missingBillViews(rows: readonly MissingBill[], search: string, now = new Date()): MissingBillView[] {
  return rows.map((row) => {
    const income = row.direction === "income";
    const name = partyName(row);
    return {
      id: `${row.direction ?? "expense"}:${row.party_id ?? row.supplier_id ?? name}:${row.currency}`,
      name,
      income,
      place: missingBillPlace(row),
      usual: usualDayText(row.typical_day, row.last_doc_date, now, row.pace),
      minor: abs(row.typical_amount_minor),
      currency: row.currency,
      href: missingBillHref(name === "ללא שם" ? "" : name, search, income),
      alertKey: row.alert_key ?? null,
      match: missingBillMatch(row, now),
    };
  });
}


/** One row of the "הגיעו החודש" section. */
export type ArrivedView = {
  id: string;
  name: string;
  income: boolean;
  place: string | null;
  /** This month's amount so far, unsigned. */
  minor: bigint;
  currency: string;
  /** Signed whole percent off the usual amount, shown only on a change this user has not hidden. */
  changePercent: number | null;
  /** The change is bad news: an expense up, or income down. */
  worse: boolean;
  /** The key that hides the change for this user; null when there is nothing to hide. */
  alertKey: string | null;
  /** The payment's page. */
  href: string;
};

/**
 * FLOW-415 (owner, 08:43Z, frame b-2): every recurring party seen this month (`recurring_this_month`).
 * A change is shown only while it is still in `recurring_changes` for this user, so a hidden change
 * leaves the row and drops its percent.
 */
export function arrivedViews(rows: readonly RecurringChange[], open: readonly RecurringChange[], search: string): ArrivedView[] {
  const shown = new Set(open.map((row) => row.alert_key ?? row.transaction_id));
  return rows.map((row) => {
    const income = row.direction === "income";
    const key = row.alert_key ?? row.transaction_id;
    const live = row.changed === true && shown.has(key);
    return {
      id: `${row.direction ?? "expense"}:${row.party_id ?? row.supplier_id ?? row.transaction_id}:${row.currency}`,
      name: partyName(row),
      income,
      place: missingBillPlace(row),
      minor: abs(row.amount_minor),
      currency: row.currency,
      changePercent: live ? row.change_percent : null,
      worse: income ? row.change_percent < 0 : row.change_percent > 0,
      alertKey: live ? key : null,
      href: `/transactions/${row.transaction_id}${search}`,
    };
  });
}

/** FLOW-415 (b-2): הגיעו החודש, every recurring party seen this month. */
export function useRecurringThisMonthQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["recurring-this-month", preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<RecurringChange[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("recurring_this_month", {});
      if (error) throw error;
      return (await loadReadSchemas()).recurringThisMonthSchema.parse(data);
    },
  });
}
