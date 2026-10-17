import { formatAmountText, type PartyCharges } from "@flow/shared";
import { absAgorot } from "./agorot";
import type { MissingBill, RecurringChange } from "@flow/shared";
import type { PartyChangeView } from "./party-charges";
import { changePercentOf, daysBetween, type ScheduleRow } from "./recurring-schedule";

/**
 * FLOW-447c: the charge page's own rules, as pure functions. The page is one recurring party: its
 * schedule row, its newest line, the late bill or change that alerts it, and its charge history.
 */

/** A change this many percent or more, either way, is news (the board's bigChange). */
export const BIG_CHANGE_PERCENT = 20;

/** The months the history draws. */
export const HISTORY_MONTHS = 6;

/** The arrival's state as the page's status line reads it. */
export type ChargeStatus = { text: string; tone: "bad" | "accent" };

/** The alert that stands on the page: a late bill (missing) or a change on an arrival. */
export type ChargeAlert = {
  kind: "missing" | "change";
  /** The key its dismissal takes; null when the read failed and the key is unknown. */
  key: string | null;
  /** Still alerting (not ignored). */
  active: boolean;
  suggestion?: MissingBill["suggestion"];
};

/** "dd/mm" from a YYYY-MM-DD day. */
export function dayMonth(day: string): string {
  const [, month = "", date = ""] = day.split("-");
  return `${date}/${month}`;
}

/** "dd/mm/yyyy" from a YYYY-MM-DD day. */
export function fullDate(day: string): string {
  const [year = "", month = "", date = ""] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** The month before or after a YYYY-MM month (delta may be negative). */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, index = 1] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The charge's percent against its usual amount when it arrived this month; null otherwise. */
export function changeFor(row: ScheduleRow): number | null {
  if (row.state !== "arrived" || row.amount_minor == null) return null;
  const usual = absAgorot(BigInt(row.typical_amount_minor));
  if (usual === 0n) return null;
  return changePercentOf(absAgorot(BigInt(row.amount_minor)), usual);
}

/** Whether the change is news: 20% or more either way. */
export function isBigChange(percent: number | null): boolean {
  return percent != null && Math.abs(percent) >= BIG_CHANGE_PERCENT;
}

/**
 * The history's change line, as the page writes it: "עלה ב־38%" or "ירד ב־20%" for a big change,
 * "כרגיל" otherwise. The words are red only when the change hurts and the alert still stands.
 */
export function changeLine(row: ScheduleRow, currency: string, alertActive: boolean): PartyChangeView {
  const usualMinor = absAgorot(BigInt(row.typical_amount_minor));
  const usual = formatAmountText(usualMinor, currency);
  const percent = changeFor(row);
  if (!isBigChange(percent) || percent == null) {
    return { percent: null, arrow: null, hurts: false, usual, change: "כרגיל", words: `כרגיל, ${usual}` };
  }
  const up = percent > 0;
  const income = row.direction === "income";
  const size = `${String(Math.abs(percent))}%`;
  return {
    percent: size,
    arrow: up ? "▲" : "▼",
    hurts: alertActive && (income ? !up : up),
    usual,
    change: `${up ? "עלה" : "ירד"} ב־${size}`,
    words: `${up ? "עלייה" : "ירידה"} של ${size} לעומת הרגיל, ${usual}`,
  };
}

/**
 * Six month bars ending at this month. The server's window ends at the newest line's month, which is
 * last month for a bill not paid yet, so the months after it pad with zero, and the oldest drop.
 */
export function monthsThrough(months: PartyCharges["months"], thisMonth: string): PartyCharges["months"] {
  const last = months.at(-1)?.month;
  const end = last != null && last > thisMonth ? last : thisMonth;
  const byMonth = new Map(months.map((entry) => [entry.month, entry.amount_minor] as const));
  return Array.from({ length: HISTORY_MONTHS }, (_, index) => {
    const month = shiftMonth(end, index - (HISTORY_MONTHS - 1));
    return { month, amount_minor: byMonth.get(month) ?? 0n };
  });
}

/** The status line: a late bill, what arrived and when, the day it is due, or the month it is next due. */
export function statusOf(row: ScheduleRow, arrivedOn: string | null): ChargeStatus {
  const income = row.direction === "income";
  if (row.state === "late") return { text: "לא הגיע", tone: "bad" };
  if (row.state === "arrived") {
    const word = income ? "התקבל" : "שולם";
    return { text: arrivedOn == null ? word : `${word} ${dayMonth(arrivedOn)}`, tone: "accent" };
  }
  if (row.state === "soon") {
    return { text: `צפוי ב־${String(row.typical_day).padStart(2, "0")}/${row.next_due_month.slice(5, 7)}`, tone: "accent" };
  }
  return { text: `הבא ב־${row.next_due_month.slice(5, 7)}/${row.next_due_month.slice(0, 4)}`, tone: "accent" };
}

/** The line under the amount: the date and the kind when it arrived, else the usual amount's wording. */
export function metaOf(row: ScheduleRow, arrivedOn: string | null): string {
  const kind = row.direction === "income" ? "הכנסה" : "הוצאה";
  if (row.state === "arrived") return arrivedOn == null ? kind : `${fullDate(arrivedOn)} · ${kind}`;
  const pending = row.direction === "income" ? "עוד לא התקבל" : "עוד לא שולם";
  return `${kind} · הסכום הרגיל, ${pending}`;
}

/** The late days, counted from the usual day, as the list counts them. */
export function lateDays(row: ScheduleRow, today: string): number {
  const usualDay = `${row.next_due_month}-${String(row.typical_day).padStart(2, "0")}`;
  return daysBetween(usualDay, today);
}

/** The banner's words for an alert that stands: late days, or the change's direction and size. */
export function bannerText(row: ScheduleRow, alert: ChargeAlert, today: string): string {
  if (alert.kind === "missing") {
    return `${row.direction === "income" ? "התקבול" : "החשבון"} באיחור ${String(lateDays(row, today))} ימים`;
  }
  const percent = changeFor(row) ?? 0;
  return `${percent > 0 ? "גבוה ב־" : "נמוך ב־"}${String(Math.abs(percent))}% מהרגיל`;
}

/** The grey line after an ignore: it comes back on the next late bill, or the next change. */
export function ignoredText(kind: ChargeAlert["kind"]): string {
  return kind === "missing" ? "התעלמת מההתראה. היא תחזור אם גם החיוב הבא יאחר." : "התעלמת מההתראה. היא תחזור בשינוי הבא.";
}

/**
 * The alert the page shows for a party. A late party alerts through missing_bills; a charge that
 * arrived 20% or more off alerts through recurring_changes (keyed by its arrival line). With a read
 * still loading or failed, the alert stands with no key, so a failed read never hides it.
 */
export function chargeAlert(
  row: ScheduleRow,
  bills: readonly MissingBill[] | undefined,
  changes: readonly RecurringChange[] | undefined,
  lineId: string | null,
): ChargeAlert | null {
  if (row.state === "late") {
    if (bills === undefined) return { kind: "missing", key: null, active: true };
    const bill = bills.find((item) => item.party_id === row.party_id && item.direction === row.direction);
    if (bill != null) return { kind: "missing", key: bill.alert_key ?? null, active: true, suggestion: bill.suggestion ?? null };
    // Not listed: ignored. The key is the one the server built for this bill (direction:party:currency:month).
    return { kind: "missing", key: `${row.direction}:${row.party_id}:${row.currency}:${row.next_due_month}`, active: false };
  }
  if (!isBigChange(changeFor(row))) return null;
  if (changes === undefined) return { kind: "change", key: lineId, active: true };
  const change = changes.find((item) => item.party_id === row.party_id);
  if (change != null) return { kind: "change", key: change.transaction_id, active: true };
  return { kind: "change", key: lineId, active: false };
}

/** The page's path for a party, carrying the preview query when the page is a preview. */
export function chargeHref(direction: "income" | "expense", partyId: string, search = ""): string {
  return `/recurring/${direction}/${encodeURIComponent(partyId)}${search}`;
}

/** The amount the page draws: this month's arrival, else the usual amount (muted). */
export function amountOf(row: ScheduleRow): { minor: bigint; muted: boolean } {
  if (row.state === "arrived" && row.amount_minor != null) return { minor: absAgorot(BigInt(row.amount_minor)), muted: false };
  return { minor: absAgorot(BigInt(row.typical_amount_minor)), muted: true };
}
