import { useMemo } from "react";
import { groupRecurring, monthOutflow, type RecurringLine } from "../recurring-layout";
import { type ScheduleRow, scheduleLines, useRecurringScheduleQuery } from "../recurring-schedule";
import { type RecurringListGroup, type RecurringListRow, RecurringList } from "../ui/recurring-list";
import { RecurringSkeleton } from "../ui/screen-skeletons";

/** The Israel calendar day as YYYY-MM-DD, the day the server counts lateness from. */
function israelToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

/** Whole days from one YYYY-MM-DD day to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** "אוקטובר 2026" for the day's month. */
function monthTitle(today: string): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`));
}

/** FLOW-447: the קבועים list. Late bills lead; the rest group by category, in the server's order. */
export function RecurringScreen({ now = new Date(), sample }: { now?: Date; sample?: readonly ScheduleRow[] } = {}) {
  const query = useRecurringScheduleQuery(sample == null);
  const rows = sample ?? query.data;
  const view = useMemo(() => (rows == null ? null : recurringView(rows, israelToday(now))), [rows, now]);
  if (view == null) return sample == null ? <RecurringSkeleton /> : null;
  return <RecurringList {...view} />;
}

/**
 * The list's props from the server rows. The outflow counts every charge; a late charge leaves its
 * group's rows (it leads the list) but still counts in its group's monthly cost, as the board does.
 */
export function recurringView(rows: readonly ScheduleRow[], today: string) {
  const lines = scheduleLines(rows);
  const byId = new Map(rows.map((row) => [row.party_id, row] as const));
  const lateIds = new Set(rows.filter((row) => row.state === "late").map((row) => row.party_id));
  const toRow = (line: RecurringLine): RecurringListRow => {
    const row = byId.get(line.id);
    if (row == null) throw new Error("recurring row");
    return {
      id: row.party_id,
      name: row.party_name,
      // The place is the project; a charge with no project shows its category instead.
      place: row.project_name || row.category_name || null,
      income: line.income,
      paid: line.arrived,
      minor: line.minor,
      ...hintFor(row, line, today),
    };
  };
  const late = lines.filter((line) => lateIds.has(line.id)).map((line) => toRow(line));
  const groups: RecurringListGroup[] = groupRecurring(lines).map((group) => ({
    id: `${group.income ? "in" : "out"}:${group.name}`,
    title: group.name,
    income: group.income,
    monthlyMinor: group.monthlyMinor,
    rows: group.lines.filter((line) => !lateIds.has(line.id)).map((line) => toRow(line)),
  }));
  return {
    subtitle: `${monthTitle(today)} • ${String(rows.length)} קבועים`,
    currency: rows[0]?.currency ?? "ILS",
    outflow: monthOutflow(lines),
    late,
    groups,
  };
}

/**
 * The one extra line a row may carry: "באיחור N ימים" for a late charge (counted from its usual day),
 * or "▲ N%" when it arrived 20% or more above its usual amount. Only bad news is shown.
 */
function hintFor(row: ScheduleRow, line: RecurringLine, today: string): Pick<RecurringListRow, "hint" | "alert"> {
  if (row.state === "late") {
    const usualDay = `${row.next_due_month}-${String(row.typical_day).padStart(2, "0")}`;
    return { hint: `באיחור ${String(daysBetween(usualDay, today))} ימים`, alert: true };
  }
  if (row.state === "arrived" && line.usual > 0n && line.minor * 100n >= line.usual * 120n) {
    const percent = Math.round(Number(((line.minor - line.usual) * 10000n) / line.usual) / 100);
    return { hint: `▲ ${String(percent)}%`, alert: true };
  }
  return {};
}
