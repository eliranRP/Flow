import {
  expectedMonthsSchema,
  missingBillsSchema,
  type ExpectedMonths,
  type ExpectedParty,
  type MissingBill,
} from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { useHomePreview } from "./preview";
import { SEARCH_MAX_LENGTH } from "./search";
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
  /** "עד 07/10": the day the bill is late from. */
  due: string;
  /** The typical amount, unsigned (the list is all expenses). */
  minor: bigint;
  currency: string;
  /** Search, filtered to this supplier's expenses. */
  href: string;
};

/** Search with the supplier's name typed and the expense side set, keeping the preview flag. */
export function missingBillHref(name: string, search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("q", name.slice(0, SEARCH_MAX_LENGTH));
  params.set("dir", "expense");
  return `/search?${params.toString()}`;
}

export function missingBillViews(rows: readonly MissingBill[], search: string, now = new Date()): MissingBillView[] {
  return rows.map((row) => ({
    id: `${row.supplier_id}:${row.currency}`,
    name: row.supplier_name === "" ? "ללא שם" : row.supplier_name,
    due: `עד ${formatDayMonth(row.expected_by, now)}`,
    minor: abs(row.typical_amount_minor),
    currency: row.currency,
    href: missingBillHref(row.supplier_name, search),
  }));
}

/** The Home pending card's third row: a count, never a total (plan default 3). */
export function missingBillsTitle(count: number): string {
  return count === 1 ? "חשבון אחד לא הגיע" : `${String(count)} חשבונות לא הגיעו`;
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

/** Expenses first, then income; the bigger amount first; then by name. */
function partyOrder(a: ExpectedPartyView, b: ExpectedPartyView): number {
  if (a.direction !== b.direction) return a.direction === "expense" ? -1 : 1;
  if (a.minor !== b.minor) return a.minor > b.minor ? -1 : 1;
  return a.name.localeCompare(b.name, "he");
}

/**
 * The month rows of the project's "צפוי" section. Each row carries the expected expense only
 * (one number per row); income shows in the month's sheet. `fallbackCurrency` names the zero of
 * a month with nothing in it.
 */
export function expectedMonthViews(data: ExpectedMonths, fallbackCurrency = "ILS"): ExpectedMonthView[] {
  return data.months.map((month) => {
    const spent = month.by_currency
      .map((row) => ({ currency: row.currency, minor: abs(row.expense_minor) }))
      .filter((row) => row.minor !== 0n);
    const parties = data.recurring
      .filter((party) => !month.open || !party.seen_this_month)
      .map(partyView)
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
      return missingBillsSchema.parse(data);
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
      return expectedMonthsSchema.parse(data);
    },
  });
}
