import { formatAmountText, type SearchPage, type SearchRow } from "@flow/shared";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { allTime, periodFromSearch, periodSearch, type PeriodChoice } from "./period";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";
import type { MonthTotal } from "./ui/month-groups";

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

/**
 * A typed amount as a minor-unit range: "8940" is every line from 8,940.00 to 8,940.99, "8940.1"
 * is 8,940.10 to 8,940.19, "8940.17" is that cent alone. Separators and a currency sign are
 * ignored. Null when the text is not a plain amount (an invoice number, a date).
 */
export function searchAmountRange(text: string): { min: bigint; max: bigint } | null {
  const cleaned = text.replace(/[\s,]/g, "").replace(/^[$₪-]+/, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (match == null) return null;
  const base = BigInt(match[1] ?? "0") * 100n;
  const frac = match[2];
  if (frac == null) return { min: base, max: base + 99n };
  // "8940.1" is ten agorot, so it spans the tenth of the cent range: 10 to 19.
  const low = frac.length === 1 ? BigInt(frac) * 10n : BigInt(frac);
  return { min: base + low, max: base + low + (frac.length === 1 ? 9n : 0n) };
}

export type AmountRange = { min: bigint; max: bigint };

/**
 * Where each read of a page resumes: `text` for the typed text, `amount` for the amount range
 * (null once that read has no more lines, or when the text is not an amount).
 */
export type SearchCursor = { text: number | null; amount: number | null };

/** A page as the screen reads it: the merged lines, the total, the months, and where to resume. */
export type SearchReadPage = SearchPage & { next: SearchCursor | null };

/**
 * The RPC's arguments for one page (decision 0140). The text is trimmed; empty means every line.
 * With `amount`, the read takes that range and no text: the amount read of a numeric search.
 */
export function searchArgs(filters: SearchFilters, offset: number, amount: AmountRange | null = null) {
  const q = filters.q.trim().slice(0, SEARCH_MAX_LENGTH);
  return {
    p_scope: filters.review ? "pending" : "all",
    p_limit: SEARCH_PAGE,
    p_offset: offset,
    ...(q === "" || amount != null ? {} : { p_query: q }),
    ...(amount ? { p_amount_min: Number(amount.min), p_amount_max: Number(amount.max) } : {}),
    ...(filters.period.from ? { p_from: filters.period.from } : {}),
    ...(filters.period.to ? { p_to: filters.period.to } : {}),
    ...(filters.project ? { p_project: filters.project } : {}),
    ...(filters.category ? { p_category: filters.category } : {}),
    ...(filters.direction ? { p_direction: filters.direction } : {}),
  };
}

/** Each line once, newest first as the server orders them (date, then description, then id). */
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

/** The order the server sends a page in, so a merged page reads the same. */
function sortLikeServer(rows: SearchRow[]): SearchRow[] {
  return rows.sort((a, b) => {
    if (a.doc_date !== b.doc_date) return a.doc_date < b.doc_date ? 1 : -1;
    if (a.description !== b.description) return a.description < b.description ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Where one read resumes after `page`, which started at `offset`; null when it has no more. */
function resumeAt(page: SearchPage, offset: number): number | null {
  if (page.expenses.length === 0) return null;
  const after = offset + page.expenses.length;
  return after < page.total ? after : null;
}

/** Income and expenses of two month rows, one minus the other (the overlap a both-reads line adds). */
function minusMonth(all: NonNullable<SearchPage["months"]>[number], part: NonNullable<SearchPage["months"]>[number]) {
  return { ...all, income_minor: all.income_minor - part.income_minor, expense_minor: all.expense_minor - part.expense_minor };
}

/**
 * One merged page. The text read and the amount read can both find a line (a description with the
 * number in it, at that amount), so the total and the month totals are exact only with the overlap
 * taken out: total = text + amount - both, and each month the same. `both` is the RPC read with the
 * text and the amount range together (the server ANDs them), on page 0 only. Lines are deduped by id.
 */
export function mergeSearchPages(reads: {
  text?: { page: SearchPage; offset: number };
  amount?: { page: SearchPage; offset: number };
  both?: SearchPage;
}): SearchReadPage {
  const pages = [reads.text?.page, reads.amount?.page].filter((page): page is SearchPage => page != null);
  const [first] = pages;
  if (first == null) throw new Error("mergeSearchPages: no read");
  const overlap = reads.both;
  const expenses = sortLikeServer(uniqueSearchRows(pages));
  const monthRows = new Map<string, NonNullable<SearchPage["months"]>[number]>();
  for (const page of pages) {
    for (const row of page.months ?? []) {
      const key = `${row.month}|${row.currency}`;
      const sum = monthRows.get(key);
      monthRows.set(key, sum == null ? { ...row } : { ...sum, income_minor: sum.income_minor + row.income_minor, expense_minor: sum.expense_minor + row.expense_minor });
    }
  }
  for (const row of overlap?.months ?? []) {
    const key = `${row.month}|${row.currency}`;
    const sum = monthRows.get(key);
    if (sum != null) monthRows.set(key, minusMonth(sum, row));
  }
  const months = pages.some((page) => page.months != null) ? [...monthRows.values()] : undefined;
  const total = pages.reduce((sum, page) => sum + page.total, 0) - (overlap?.total ?? 0);
  const next: SearchCursor = {
    text: reads.text ? resumeAt(reads.text.page, reads.text.offset) : null,
    amount: reads.amount ? resumeAt(reads.amount.page, reads.amount.offset) : null,
  };
  return {
    ...first,
    expenses,
    total,
    months,
    next: next.text == null && next.amount == null ? null : next,
  };
}

/** The first page's cursor: the text read always, the amount read too when the text is an amount. */
export function initialSearchCursor(filters: SearchFilters): SearchCursor {
  return { text: 0, amount: searchAmountRange(filters.q.trim()) == null ? null : 0 };
}

export function useSearchQuery(filters: SearchFilters, active = true) {
  const preview = useHomePreview();
  const key = searchArgs(filters, 0);
  const amount = searchAmountRange(filters.q.trim());
  return useInfiniteQuery({
    queryKey: ["search", preview, key],
    enabled: active && preview === "off",
    // Typing keeps the last results on screen until the new read lands.
    placeholderData: keepPreviousData,
    initialPageParam: initialSearchCursor(filters),
    queryFn: async ({ pageParam }): Promise<SearchReadPage> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const schema = (await loadReadSchemas()).searchPageSchema;
      const read = async (args: ReturnType<typeof searchArgs>) => {
        const { data, error } = await supabase.rpc("search_transactions", args);
        if (error) throw error;
        return schema.parse(data);
      };
      // The reads of a page run at once; each one pages on its own offset. The overlap read (both
      // filters, one line) is needed on the first page only: its total and months are the overlap.
      const first = pageParam.text === 0;
      const [text, byAmount, both] = await Promise.all([
        pageParam.text == null ? undefined : read(searchArgs(filters, pageParam.text)),
        amount == null || pageParam.amount == null ? undefined : read(searchArgs(filters, pageParam.amount, amount)),
        amount == null || !first ? undefined : read({ ...searchArgs(filters, 0, amount), p_query: filters.q.trim(), p_limit: 1 }),
      ]);
      return mergeSearchPages({
        text: text && pageParam.text != null ? { page: text, offset: pageParam.text } : undefined,
        amount: byAmount && pageParam.amount != null ? { page: byAmount, offset: pageParam.amount } : undefined,
        both,
      });
    },
    getNextPageParam: (last) => last.next ?? undefined,
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
 * What a row adds to its month head: a kept-out line adds nothing, as on the
 * project page (0099). Otherwise the line's own amount in its own currency.
 */
export function searchRowAmount(row: SearchRow): { minor: bigint; currency: string; direction: SearchDirection } {
  return { minor: row.kept_out ? 0n : row.amount_net, currency: row.currency, direction: row.direction };
}

/**
 * The server's month totals as MonthList reads them, ILS first in each month; undefined when
 * there are none (sample rows, or a reply from before the server sent them).
 */
export function searchMonthTotals(months: SearchPage["months"]): Map<string, MonthTotal[]> | undefined {
  if (months == null) return undefined;
  const byMonth = new Map<string, MonthTotal[]>();
  for (const row of months) {
    const list = byMonth.get(row.month) ?? [];
    list.push({ currency: row.currency, incomeMinor: row.income_minor, expenseMinor: row.expense_minor });
    byMonth.set(row.month, list);
  }
  for (const list of byMonth.values()) list.sort((a, b) => Number(a.currency !== "ILS") - Number(b.currency !== "ILS"));
  return byMonth;
}

/** "תנועה אחת" or "N תנועות". */
export function searchCountWords(count: number): string {
  return count === 1 ? "תנועה אחת" : `${String(count)} תנועות`;
}

/**
 * The server's rules on rows already in hand, for sample and dev lists only: the text in the
 * description, supplier, customer, project or category name (any case), or with a typed amount
 * the line's amount in that range (the live read's OR); the direction, the line's own project and
 * category (or `none`), the dates and the review state. Split parts and shares are the server's.
 */
export function filterSearchRows(rows: readonly SearchRow[], filters: SearchFilters): SearchRow[] {
  const q = filters.q.trim().toLowerCase();
  const amount = searchAmountRange(filters.q.trim());
  return sortLikeServer(rows.filter((row) => {
    if (q !== "") {
      const text = [row.description, row.supplier_name, row.customer_name, row.project_name, row.category_name]
        .some((value) => (value ?? "").toLowerCase().includes(q));
      const abs = row.amount_net < 0n ? -row.amount_net : row.amount_net;
      const byAmount = amount != null && abs >= amount.min && abs <= amount.max;
      if (!text && !byAmount) return false;
    }
    if (filters.direction && row.direction !== filters.direction) return false;
    if (filters.project === "none" ? row.project_id != null : filters.project != null && row.project_id !== filters.project) return false;
    if (filters.category === "none" ? row.category_id != null : filters.category != null && row.category_id !== filters.category) return false;
    if (filters.period.from && row.doc_date < filters.period.from) return false;
    if (filters.period.to && row.doc_date > filters.period.to) return false;
    if (filters.review && !row.waiting_review) return false;
    return true;
  }));
}

/** A row's money as a month total (income or expense, its own currency; kept-out counts nothing). */
export function searchRowTotals(rows: readonly SearchRow[]): MonthTotal[] {
  return rows.map((row) => {
    const { minor, direction } = searchRowAmount(row);
    const abs = minor < 0n ? -minor : minor;
    return { currency: row.currency, incomeMinor: direction === "income" ? abs : 0n, expenseMinor: direction === "expense" ? abs : 0n };
  });
}

/**
 * The count line's money (FLOW-368 §2.4): income minus expenses over every matching line, in the
 * first currency (ILS first). Null when there are no lines.
 */
export function searchTotalText(totals: readonly MonthTotal[]): string | null {
  const first = totals.find((total) => total.currency === "ILS") ?? totals[0];
  if (first == null) return null;
  let minor = 0n;
  for (const total of totals) {
    if (total.currency === first.currency) minor += total.incomeMinor - total.expenseMinor;
  }
  return formatAmountText(minor, first.currency);
}
