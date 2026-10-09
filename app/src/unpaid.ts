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
