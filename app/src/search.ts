import { searchPageSchema, type SearchPage, type SearchRow } from "@flow/shared";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getSupabase } from "./lib/supabase";
import { allTime, periodFromSearch, periodSearch, type PeriodChoice } from "./period";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";

/**
 * The transaction search (FLOW-323, option A; FLOW-402 is the same screen with a project set).
 * The filters live in the URL, so Back from a line returns to the same list.
 */
export type SearchDirection = "income" | "expense";

export type SearchFilters = {
  /** Typed text: supplier, customer or description (decision 0140). */
  q: string;
  direction: SearchDirection | null;
  /** A project id, or "none" for lines on no project. */
  project: string | null;
  /** A category id, or "none" for lines with no category. */
  category: string | null;
  period: PeriodChoice;
  /** Only lines waiting for review (the RPC's pending scope). */
  review: boolean;
};

export const EMPTY_FILTERS: SearchFilters = {
  q: "",
  direction: null,
  project: null,
  category: null,
  period: allTime(),
  review: false,
};

/** One page of the RPC. 100 is the server's cap; 50 keeps the first paint quick. */
export const SEARCH_PAGE = 50;

/** The typed text waits this long before it asks the server. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The server takes at most this much text; a longer paste is cut, never refused. */
export const SEARCH_MAX_LENGTH = 100;

const ID = /^[A-Za-z0-9-]{1,64}$/;
/** The server takes a uuid or "none" and refuses anything else (0140), so a live read sends no other id. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(value: string | null, ids: "uuid" | "any"): string | null {
  if (value == null) return null;
  if (value === "none") return "none";
  return (ids === "uuid" ? UUID : ID).test(value) ? value : null;
}

/** A calendar day the server's `::date` reads: 2026-02-31 passes the shape but is no day. */
function realDay(value: string | null): boolean {
  if (value == null) return true;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The filters a URL carries. Anything unknown or broken falls back to "no filter", so a hand-edited
 * link never sends the server a value it refuses. `ids: "any"` keeps the short ids of sample and
 * preview lists; a live read takes uuids only.
 */
export function readSearchFilters(
  params: URLSearchParams,
  now = new Date(),
  { ids = "uuid" }: { ids?: "uuid" | "any" } = {},
): SearchFilters {
  const dir = params.get("dir");
  const period = periodFromSearch(params, now) ?? allTime();
  return {
    q: (params.get("q") ?? "").slice(0, SEARCH_MAX_LENGTH),
    direction: dir === "income" || dir === "expense" ? dir : null,
    project: idParam(params.get("project"), ids),
    category: idParam(params.get("category"), ids),
    period: realDay(period.from) && realDay(period.to) ? period : allTime(),
    review: params.get("review") === "1",
  };
}

/** The URL query for these filters, keeping `preview` (and anything else) from `base`. */
export function searchFiltersQuery(filters: SearchFilters, base: URLSearchParams = new URLSearchParams(), now = new Date()): string {
  const next = new URLSearchParams(base);
  for (const key of ["q", "dir", "project", "category", "review", "period", "at", "from", "to"]) next.delete(key);
  if (filters.q.trim() !== "") next.set("q", filters.q);
  if (filters.direction) next.set("dir", filters.direction);
  if (filters.project) next.set("project", filters.project);
  if (filters.category) next.set("category", filters.category);
  if (filters.review) next.set("review", "1");
  if (filters.period.kind !== "all") {
    for (const [key, value] of Object.entries(periodSearch(filters.period, now))) next.set(key, value);
  }
  const text = next.toString();
  return text === "" ? "" : `?${text}`;
}

/** True when any chip is on. The text is not a chip. */
export function hasChipFilters(filters: SearchFilters): boolean {
  return filters.direction != null
    || filters.project != null
    || filters.category != null
    || filters.review
    || filters.period.kind !== "all";
}

/** The RPC's arguments for one page (decision 0140). The text is trimmed; empty means every line. */
export function searchArgs(filters: SearchFilters, offset: number) {
  const q = filters.q.trim().slice(0, SEARCH_MAX_LENGTH);
  return {
    p_scope: filters.review ? "pending" : "all",
    p_limit: SEARCH_PAGE,
    p_offset: offset,
    ...(q === "" ? {} : { p_query: q }),
    ...(filters.period.from ? { p_from: filters.period.from } : {}),
    ...(filters.period.to ? { p_to: filters.period.to } : {}),
    ...(filters.project ? { p_project: filters.project } : {}),
    ...(filters.category ? { p_category: filters.category } : {}),
    ...(filters.direction ? { p_direction: filters.direction } : {}),
  };
}

/**
 * Each line once. Offset pages can repeat a line when a new one lands between two reads; a repeat
 * would draw twice and break the row keys and the ˄ ˅ list.
 */
export function uniqueSearchRows(pages: readonly SearchPage[]): SearchRow[] {
  const seen = new Set<string>();
  const rows: SearchRow[] = [];
  for (const page of pages) {
    for (const row of page.expenses) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

/** Pages until every matching line is loaded. */
export function nextSearchOffset(page: SearchPage, pages: readonly SearchPage[]): number | undefined {
  const loaded = pages.reduce((sum, item) => sum + item.expenses.length, 0);
  if (page.expenses.length === 0) return undefined;
  return loaded < page.total ? loaded : undefined;
}

export function useSearchQuery(filters: SearchFilters, active = true) {
  const preview = useHomePreview();
  const key = searchArgs(filters, 0);
  return useInfiniteQuery({
    queryKey: ["search", preview, key],
    enabled: active && preview === "off",
    // Typing keeps the last results on screen until the new read lands.
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<SearchPage> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("search_transactions", searchArgs(filters, pageParam));
      if (error) throw error;
      return searchPageSchema.parse(data);
    },
    getNextPageParam: nextSearchOffset,
  });
}

/** The value after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      window.clearTimeout(id);
    };
  }, [value, ms]);
  return settled;
}

/** The row's counterparty: the customer on income, else the supplier, else the description. */
export function searchRowTitle(row: SearchRow): string {
  if (row.direction === "income" && row.customer_name) return row.customer_name;
  return row.supplier_name ?? row.customer_name ?? row.description;
}

/**
 * What a row adds to its month head and the count line: a kept-out line adds nothing, as on the
 * project page (0099). Otherwise the line's own amount in its own currency.
 */
export function searchRowAmount(row: SearchRow): { minor: bigint; currency: string; direction: SearchDirection } {
  return { minor: row.kept_out ? 0n : row.amount_net, currency: row.currency, direction: row.direction };
}

export type SearchTotal = { currency: string; incomeMinor: bigint; expenseMinor: bigint };

/** Money in and out per currency over the shown rows, ILS first, then in the order seen. */
export function searchTotals(rows: readonly SearchRow[]): SearchTotal[] {
  const totals: SearchTotal[] = [];
  for (const row of rows) {
    const amount = searchRowAmount(row);
    const abs = amount.minor < 0n ? -amount.minor : amount.minor;
    let total = totals.find((item) => item.currency === amount.currency);
    if (!total) {
      total = { currency: amount.currency, incomeMinor: 0n, expenseMinor: 0n };
      totals.push(total);
    }
    if (amount.direction === "income") total.incomeMinor += abs;
    else total.expenseMinor += abs;
  }
  return totals.sort((a, b) => (a.currency === "ILS" ? 0 : 1) - (b.currency === "ILS" ? 0 : 1));
}

/** "תנועה אחת" or "N תנועות". */
export function searchCountWords(count: number): string {
  return count === 1 ? "תנועה אחת" : `${String(count)} תנועות`;
}

/**
 * The server's rules on rows already in hand, for sample and dev lists only: the text in the
 * description, supplier or customer (any case), the direction, the line's own project and
 * category (or `none`), the dates and the review state. Split parts and shares are the server's.
 */
export function filterSearchRows(rows: readonly SearchRow[], filters: SearchFilters): SearchRow[] {
  const q = filters.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (q !== "" && ![row.description, row.supplier_name, row.customer_name].some((text) => (text ?? "").toLowerCase().includes(q))) return false;
    if (filters.direction && row.direction !== filters.direction) return false;
    if (filters.project === "none" ? row.project_id != null : filters.project != null && row.project_id !== filters.project) return false;
    if (filters.category === "none" ? row.category_id != null : filters.category != null && row.category_id !== filters.category) return false;
    if (filters.period.from && row.doc_date < filters.period.from) return false;
    if (filters.period.to && row.doc_date > filters.period.to) return false;
    if (filters.review && !row.waiting_review) return false;
    return true;
  });
}
