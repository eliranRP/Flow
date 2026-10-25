import type { WeeklySummary } from "@flow/shared";
import { HEBREW_MONTHS, israelToday, shiftDays } from "./ui/date-math";

/** `?week=YYYY-MM-DD` when it names a Sunday no later than today's week, else null. */
export function weekFromSearch(search: string, today = israelToday()): string | null {
  const raw = new URLSearchParams(search).get("week");
  if (raw == null || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const day = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== raw || day.getUTCDay() !== 0) return null;
  return raw > today ? null : raw;
}

/** The address without `?week=`, keeping every other parameter. */
export function searchWithoutWeek(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("week");
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}

function dayAndMonth(iso: string): { day: number; month: string } {
  return { day: Number(iso.slice(8, 10)), month: HEBREW_MONTHS[Number(iso.slice(5, 7)) - 1] ?? "" };
}

/** "ראשון 4 עד שבת 10 באוקטובר"; across two months, "ראשון 27 בספטמבר עד שבת 3 באוקטובר". */
export function weekLabel(weekStart: string): string {
  const from = dayAndMonth(weekStart);
  const to = dayAndMonth(shiftDays(weekStart, 6));
  const head = from.month === to.month ? `ראשון ${String(from.day)}` : `ראשון ${String(from.day)} ב${from.month}`;
  return `${head} עד שבת ${String(to.day)} ב${to.month}`;
}

/** "23 תנועות נכנסו השבוע", "תנועה אחת נכנסה השבוע", "לא נכנסו תנועות השבוע" (the push's words). */
export function linesText(lines: number): string {
  if (lines === 0) return "לא נכנסו תנועות השבוע";
  if (lines === 1) return "תנועה אחת נכנסה השבוע";
  return `${String(lines)} תנועות נכנסו השבוע`;
}

/** The centred count under the sheet: the lines, then how many were approved without a tap. */
export function countsText(summary: Pick<WeeklySummary, "lines" | "auto_approved">): string {
  const auto = summary.auto_approved === 0 ? "" : summary.lines === 1 ? "אושרה אוטומטית" : `${String(summary.auto_approved)} אושרו אוטומטית`;
  return auto === "" ? linesText(summary.lines) : `${linesText(summary.lines)} · ${auto}`;
}

/**
 * Under the profit when some of the week's lines still wait: they count in it already (as on Home,
 * 0050), so a review can still move it.
 */
export function countedNote(summary: Pick<WeeklySummary, "week_waiting">): string | null {
  if (summary.week_waiting === 0) return null;
  return summary.week_waiting === 1 ? "כולל אחת שעוד מחכה לאישור" : `כולל ${String(summary.week_waiting)} שעוד מחכות לאישור`;
}

/** About 20 seconds an item: "פחות מדקה", "כדקה", "כ־4 דקות". */
export function reviewMinutes(waiting: number): string {
  const minutes = Math.round((waiting * 20) / 60);
  if (minutes < 1) return "פחות מדקה";
  if (minutes === 1) return "כדקה";
  return `כ־${String(minutes)} דקות`;
}

/** The review button: "לאישור פריט אחד · פחות מדקה", "לאישור 7 פריטים · כ־2 דקות". */
export function reviewLabel(waiting: number): string {
  const items = waiting === 1 ? "פריט אחד" : `${String(waiting)} פריטים`;
  return `לאישור ${items} · ${reviewMinutes(waiting)}`;
}

/** "ועוד 2 פרויקטים מעל התקציב", "ועוד פרויקט אחד מעל התקציב". */
export function moreOverBudgetText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "ועוד פרויקט אחד מעל התקציב" : `ועוד ${String(count)} פרויקטים מעל התקציב`;
}

/** The overrun as a whole percent of the budget: $58,240 of $52,000 is 112. */
export function budgetPercent(spent: bigint, budget: bigint): number {
  if (budget <= 0n) return 0;
  return Math.round(Number((spent * 1000n) / budget) / 10);
}

/** The change in profit from the week before, and whether it helps; null with no lines or no week before. */
export function profitChange(summary: Pick<WeeklySummary, "lines" | "profit_minor" | "prev_profit_minor">): { minor: bigint; tone: "helps" | "hurts" } | null {
  if (summary.lines === 0 || summary.prev_profit_minor == null) return null;
  const minor = summary.profit_minor - summary.prev_profit_minor;
  return { minor, tone: minor >= 0n ? "helps" : "hurts" };
}

/** The address with `?week=<Sunday>`, keeping every other parameter: the sheet's own link (the push's). */
export function searchWithWeek(search: string, weekStart: string): string {
  const params = new URLSearchParams(search);
  params.set("week", weekStart);
  return `?${params.toString()}`;
}

/**
 * The card's status beside the profit. What waits is the whole open queue, as the sheet's button
 * and the push count it.
 */
export function cardStatus(summary: Pick<WeeklySummary, "lines" | "waiting">): { text: string; tone: "waiting" | "done" | "empty" } {
  if (summary.waiting > 0) {
    return { text: summary.waiting === 1 ? "אחת מחכה לאישור" : `${String(summary.waiting)} מחכות לאישור`, tone: "waiting" };
  }
  if (summary.lines === 0) return { text: "לא נכנסו תנועות", tone: "empty" };
  return { text: "הכול מאושר", tone: "done" };
}
