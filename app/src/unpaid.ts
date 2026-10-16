import type { UnpaidRow } from "@flow/shared";
import { absAgorot } from "./agorot";

/** FLOW-330. A row the owner marked paid waits for the sync and is out of every unpaid total. */
export function unpaidIsMarked(row: UnpaidRow): boolean {
  return row.marked_paid_at != null;
}

export function unpaidOpenRows(rows: readonly UnpaidRow[]): UnpaidRow[] {
  return rows.filter((row) => !unpaidIsMarked(row));
}

/** The open rows' gross per currency, ILS first. A row with no currency is ILS (older payloads). */
export function unpaidTotals(rows: readonly UnpaidRow[]): { currency: string; minor: bigint }[] {
  const totals = new Map<string, bigint>();
  for (const row of unpaidOpenRows(rows)) {
    const currency = row.currency ?? "ILS";
    totals.set(currency, (totals.get(currency) ?? 0n) + absAgorot(row.open_gross_agorot));
  }
  if (!totals.has("ILS")) totals.set("ILS", 0n);
  return [...totals.entries()]
    .map(([currency, minor]) => ({ currency, minor }))
    .sort((a, b) => (a.currency === "ILS" ? -1 : b.currency === "ILS" ? 1 : a.currency.localeCompare(b.currency)))
    .filter((total, index) => index === 0 || total.minor !== 0n);
}

/** Home's unpaid row: the open ILS gross. Other currencies are on the Unpaid screen. */
export function unpaidOpenGross(rows: readonly UnpaidRow[]): bigint {
  return unpaidTotals(rows).find((total) => total.currency === "ILS")?.minor ?? 0n;
}

const SUMIT_DOCUMENT_PREFIX = "https://pay.sumit.co.il/";

/**
 * FLOW-335. The row's SUMIT document link, only when it is a real https link on SUMIT's pay host;
 * anything else is dropped, so the row stays not tappable.
 */
export function unpaidDocumentUrl(row: Pick<UnpaidRow, "document_url">): string | null {
  const url = row.document_url;
  if (url == null || !url.startsWith(SUMIT_DOCUMENT_PREFIX)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.host !== "pay.sumit.co.il" || parsed.username !== "" || parsed.password !== "") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** The bank deposit the server found for an open invoice: same amount and customer, not linked or dismissed (FLOW-367). */
export type UnpaidMatch = {
  transaction_id: string;
  date: string;
  account_name: string;
  raw_description: string;
  amount_minor: bigint;
};

/**
 * An open invoice with the fields FLOW-367 adds: its number and a bank match. A row without them (an
 * older payload) shows no match and no number.
 */
export type UnpaidInvoice = UnpaidRow & {
  doc_number?: string | null;
  match?: UnpaidMatch | null;
};

/** The figures the summary card's bar needs, from the server: what was paid since issued_since (the 1st of last month). */
export type UnpaidSummary = {
  paid_agorot: bigint;
  issued_since: string;
  last_sync_at?: string | null;
};

/** FLOW-367: an open invoice older than this is in the signal colour and counted on the summary. */
export const UNPAID_OVERDUE_DAYS = 30;

/** Whole days from an ISO date to today (Israel). */
export function unpaidDaysOpen(iso: string, today: string): number {
  const start = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const end = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** The open rows in one currency that are older than UNPAID_OVERDUE_DAYS. */
export function unpaidOverdueMinor(rows: readonly UnpaidRow[], currency: string, today: string): bigint {
  return unpaidOpenRows(rows)
    .filter((row) => (row.currency ?? "ILS") === currency && unpaidDaysOpen(row.doc_date, today) > UNPAID_OVERDUE_DAYS)
    .reduce((sum, row) => sum + absAgorot(row.open_gross_agorot), 0n);
}
