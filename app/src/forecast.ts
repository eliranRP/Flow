import { formatAmountText, type ExpectedMonths, type ExpectedParty, type MissingBill } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import { searchHref } from "./search";
import { formatDayMonth, HEBREW_MONTHS } from "./ui/date-math";
import { waitForAccessToken } from "./wait-for-session";

/**
 * Jev missing bills and expected months (FLOW-403, plan option A, decision 0131). Every figure
 * and date is the server's; the app never sums a total of its own.
 */

/** The project page shows this many months, the open one first (plan default 1). */
export const EXPECTED_MONTHS = 3;

function abs(minor: bigint): bigint {
  return minor < 0n ? -minor : minor;
}

/** One row of the "לא הגיעו" list. */
export type MissingBillView = {
  id: string;
  name: string;
  /** FLOW-415: "project · category" when the bill files to one; null when neither is known. */
  place: string | null;
  /** FLOW-415: "כל חודש ב־2 · אחרון 02/09". */
  usual: string;
  /** The typical amount, unsigned (the list is all expenses). */
  minor: bigint;
  currency: string;
  /** Search, filtered to this supplier's expenses. */
  href: string;
};

/** Search with the supplier's name typed and the expense side set, keeping the preview flag. */
export function missingBillHref(name: string, search: string): string {
  return searchHref(name, search, { dir: "expense" });
}

/** FLOW-415: the pace and day a recurring charge comes ("כל חודש ב־2"), and when the last one came. */
export function usualDayText(typicalDay: number, lastDocDate: string | null | undefined, now = new Date()): string {
  const day = `כל חודש ב־${String(typicalDay)}`;
  return lastDocDate == null ? day : `${day} · אחרון ${formatDayMonth(lastDocDate, now)}`;
}

/** Names for the ids a late bill files to. A name not found leaves its half of the line out. */
export type MissingBillNames = {
  project?: (id: string) => string | undefined;
  category?: (id: string) => string | undefined;
};

/** FLOW-415: "project · category", either half alone, or null. */
export function missingBillPlace(row: Pick<MissingBill, "project_id" | "category_id">, names: MissingBillNames = {}): string | null {
  const parts = [
    row.project_id == null ? undefined : names.project?.(row.project_id),
    row.category_id == null ? undefined : names.category?.(row.category_id),
  ].filter((part): part is string => part != null && part !== "");
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function missingBillViews(rows: readonly MissingBill[], search: string, now = new Date(), names: MissingBillNames = {}): MissingBillView[] {
  return rows.map((row) => ({
    id: `${row.supplier_id}:${row.currency}`,
    name: row.supplier_name === "" ? "ללא שם" : row.supplier_name,
    place: missingBillPlace(row, names),
    usual: usualDayText(row.typical_day, row.last_doc_date, now),
    minor: abs(row.typical_amount_minor),
    currency: row.currency,
    href: missingBillHref(row.supplier_name, search),
  }));
}

/** The Home pending card's third row: a count, never a total (plan default 3). */
export function missingBillsTitle(count: number): string {
  return count === 1 ? "חשבון אחד לא הגיע" : `${String(count)} חשבונות לא הגיעו`;
}

/**
 * FLOW-415 (layout A): one payment this month that is 20% or more off its usual amount, as Home's
 * attention card shows it (`recurring_changes`). The server picks the payments and computes the
 * change; the app only words it.
 */
export type ChargeChange = {
  transaction_id: string;
  category_name: string | null;
  currency: string;
  /** This payment, signed. */
  amount_minor: bigint;
  /** The usual amount, signed. */
  typical_amount_minor: bigint;
  /** Whole percent, signed: 38 is up 38%. */
  change_percent: number;
};

export type ChargeChangeView = {
  id: string;
  /** "חשמל עלה ב־38%" or "חשמל ירד ב־25%". */
  title: string;
  /** "₪2,550" and "₪1,850", unsigned. */
  now: string;
  usual: string;
  /** The payment's page. */
  href: string;
};

export function chargeChangeViews(rows: readonly ChargeChange[], search: string): ChargeChangeView[] {
  return rows.map((row) => {
    const name = row.category_name == null || row.category_name === "" ? "ללא קטגוריה" : row.category_name;
    const percent = row.change_percent;
    return {
      id: row.transaction_id,
      title: `${name} ${percent < 0 ? "ירד" : "עלה"} ב־${String(Math.abs(percent))}%`,
      now: formatAmountText(abs(row.amount_minor), row.currency),
      usual: formatAmountText(abs(row.typical_amount_minor), row.currency),
      href: `/transactions/${row.transaction_id}${search}`,
    };
  });
}

export type ExpectedPartyView = {
  id: string;
  name: string;
  direction: "income" | "expense";
  currency: string;
  /** Unsigned typical amount. */
  minor: bigint;
};

export type ExpectedMonthView = {
  month: string;
  /** "שאר אוקטובר" for the open month, else the month's name. */
  label: string;
  open: boolean;
  /** The expected expense per currency, unsigned, ILS first. One entry at least. */
  figures: { currency: string; minor: bigint }[];
  /** Who makes up the month: the open month leaves out the parties already seen. */
  parties: ExpectedPartyView[];
};

export function expectedMonthLabel(month: string, open: boolean): string {
  const name = HEBREW_MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
  return open ? `שאר ${name}` : name;
}

function partyView(party: ExpectedParty): ExpectedPartyView {
  return {
    id: `${party.direction}:${party.party_id}:${party.currency}`,
    name: party.name,
    direction: party.direction,
    currency: party.currency,
    minor: abs(party.typical_amount_minor),
  };
}

/** The bigger amount first, then by name. */
function partyOrder(a: ExpectedPartyView, b: ExpectedPartyView): number {
  if (a.minor !== b.minor) return a.minor > b.minor ? -1 : 1;
  return a.name.localeCompare(b.name, "he");
}

/**
 * The month rows of the project's "צפוי" section. Each row carries the expected expense only
 * (one number per row), and its sheet lists only the expense parties, so they add up to the figure
 * tapped (DESIGN-RULES §3.7). `fallbackCurrency` names the zero of a month with nothing in it.
 */
export function expectedMonthViews(data: ExpectedMonths, fallbackCurrency = "ILS"): ExpectedMonthView[] {
  return data.months.map((month) => {
    const spent = month.by_currency
      .map((row) => ({ currency: row.currency, minor: abs(row.expense_minor) }))
      .filter((row) => row.minor !== 0n);
    const parties = data.recurring
      .filter((party) => !month.open || !party.seen_this_month)
      .map(partyView)
      .filter((party) => party.direction === "expense")
      .sort(partyOrder);
    return {
      month: month.month,
      label: expectedMonthLabel(month.month, month.open),
      open: month.open,
      figures: spent.length > 0 ? spent : [{ currency: month.by_currency[0]?.currency ?? fallbackCurrency, minor: 0n }],
      parties,
    };
  });
}

/** No recurring party yet: the section says so in one line. */
export function hasExpectedHistory(data: ExpectedMonths | null | undefined): boolean {
  return data != null && data.recurring.length > 0;
}

export function useMissingBillsQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["missing-bills", preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<MissingBill[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("missing_bills", {});
      if (error) throw error;
      return (await loadReadSchemas()).missingBillsSchema.parse(data);
    },
  });
}

export function useExpectedMonthsQuery(projectId: string, months = EXPECTED_MONTHS) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["expected-months", preview, projectId, months],
    enabled: preview === "off" && projectId !== "",
    queryFn: async (): Promise<ExpectedMonths> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("expected_months", { p_months: months, p_project_id: projectId });
      if (error) throw error;
      return (await loadReadSchemas()).expectedMonthsSchema.parse(data);
    },
  });
}
