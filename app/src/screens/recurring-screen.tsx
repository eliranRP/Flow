import "../ui/lazy.css";
import type { MissingBill } from "@flow/shared";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useMissingBillsQuery } from "../forecast";
import { useHomePreview, usePreviewSearch } from "../preview";
import { chargeHref, comparable, dayMonth } from "../recurring-charge";
import { groupRecurring, monthInflow, monthOutflow, type RecurringLine } from "../recurring-layout";
import { alertState, changePercentOf, daysBetween, isSplitParty, israelToday, rowId, type RecurringAlert, type ScheduleRow, scheduleLines, useRecurringScheduleQuery } from "../recurring-schedule";
import { PageLoadFailed, useOnline } from "../ui/band-states";
import { type RecurringListGroup, type RecurringListRow, RecurringHead, RecurringList, RecurringListEmpty } from "../ui/recurring-list";
import { RecurringSkeleton } from "../ui/screen-skeletons";
import { useDashboardQuery } from "../use-books";
import { useOverheadProject } from "../overhead-project";
import { addLineReady, ForecastAddLine, lineProjects } from "./forecast-add-line";

/** "אוקטובר 2026" for the day's month. */
function monthTitle(today: string): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`));
}

const NO_ROWS: readonly ScheduleRow[] = [];

/** The alert state a screen computes from the schedule and the late bills. */
type AlertState = ReturnType<typeof alertState>;

/**
 * FLOW-447, FLOW-1048 (V3-Recurring): the קבועים list. The late bills lead as cards; every charge sits in its
 * category's group, in the server's order. `?project=` narrows it to one project (FLOW-424); an unknown id shows an
 * empty list. Ignoring a late bill, its suggested match and "עדיין קבוע?" are answered on the charge page
 * (V3-Charge); a card's X only hides the card on this device.
 */
export function RecurringScreen({
  now = new Date(),
  sample,
  missing,
  failed = false,
  offlineSince,
}: {
  now?: Date;
  sample?: readonly ScheduleRow[];
  /** The dev fixture's late bills (`missing_bills`); undefined is a failed read. */
  missing?: readonly MissingBill[];
  /** The dev fixture's failed schedule read. */
  failed?: boolean;
  /** The dev fixture's offline moment: the rows on screen are from then. */
  offlineSince?: number;
} = {}) {
  const [params] = useSearchParams();
  const project = params.get("project");
  // ?preview= has no server: the loading preview keeps the skeleton, the others show an empty list.
  const preview = useHomePreview();
  const live = sample == null;
  const query = useRecurringScheduleQuery(live && preview === "off");
  const lateBills = useMissingBillsQuery(live);
  const bills = live ? lateBills.data : missing;
  const rows = sample ?? (preview === "off" ? query.data : preview === "loading" ? undefined : NO_ROWS);
  const today = israelToday(now);
  const alerts = useMemo(() => (rows == null ? undefined : alertState(rows, bills)), [rows, bills]);
  const search = usePreviewSearch();
  const view = useMemo(() => (rows == null ? null : recurringView(rows, today, project, alerts, search)), [rows, today, project, alerts, search]);
  const online = useOnline();

  const failedNow = live ? query.isError && query.data == null : failed;
  if (failedNow) {
    // FLOW-963: the failure keeps the title and says what happened, with the retry and the way to help.
    return (
      <div className="ui-recurring">
        <RecurringHead />
        <div className="ui-recurring-body">
          <PageLoadFailed title="הקבועים לא נטענו" offline={!online} onRetry={() => void (live ? query.refetch() : undefined)} />
        </div>
      </div>
    );
  }
  if (view == null) return sample == null ? <RecurringSkeleton /> : null;
  // FLOW-1014: the empty screen keeps the add row, so the first recurring line can start here.
  const addLine = live ? <RecurringAddLine month={today.slice(0, 7)} search={search} /> : null;
  if (rows != null && rows.length === 0 && project == null) return <RecurringListEmpty addLine={addLine} />;
  // Offline with rows on screen: they are from the last read (FLOW-963).
  const since = live ? (online ? undefined : query.dataUpdatedAt || undefined) : offlineSince;
  return <RecurringList {...view} offlineSince={since} addLine={addLine} />;
}

/**
 * The list's props from the server rows, for the project when one is named. The outflow counts every charge;
 * a late charge that still alerts leads the list as a card and keeps its place in its group (V3-Recurring).
 */
export function recurringView(allRows: readonly ScheduleRow[], today: string, project: string | null = null, alerts?: AlertState, search = "") {
  const rows = project == null ? allRows : allRows.filter((row) => row.project_id === project);
  const projectName = project == null ? undefined : allRows.find((row) => row.project_id === project)?.project_name ?? undefined;
  const lines = scheduleLines(rows, allRows);
  const byId = new Map(rows.map((row) => [rowId(allRows, row), row] as const));
  // A late charge that still alerts leads the list; one the user ignored is an ordinary row again.
  const state = alerts ?? alertState(allRows, undefined);
  const lateIds = new Set(rows.filter((row) => row.state === "late" && state.active.has(rowId(allRows, row))).map((row) => rowId(allRows, row)));
  const toRow = (line: RecurringLine): RecurringListRow => {
    const row = byId.get(line.id);
    if (row == null) throw new Error("recurring row");
    const alert: RecurringAlert | undefined = state.active.get(line.id);
    const hint = hintFor(row, line, today, state.dismissed.has(line.id));
    const late = lateIds.has(line.id);
    return {
      id: line.id,
      name: row.party_name,
      // The place is the project; a charge with no project shows its category instead.
      place: row.project_name || row.category_name || null,
      income: line.income,
      paid: line.arrived,
      minor: line.minor,
      mark: line.arrived ? "paid" : late ? "late" : "due",
      status: statusWords(row, hint.hint, late),
      ...hint,
      ...(alert == null ? {} : { alertKey: alert.alertKey, suggestion: alert.suggestion == null ? null : suggestionRow(alert.suggestion) }),
      href: chargeHref(row.direction, row.party_id, search, isSplitParty(allRows, row) ? row.project_id : null),
    };
  };
  const late = lines.filter((line) => lateIds.has(line.id)).map((line) => toRow(line));
  const groups: RecurringListGroup[] = groupRecurring(lines).map((group) => ({
    id: `${group.income ? "in" : "out"}:${group.name}`,
    title: group.name,
    income: group.income,
    monthlyMinor: group.monthlyMinor,
    rows: group.lines.map((line) => toRow(line)),
  }));
  return {
    project: projectName,
    subtitle: `${monthTitle(today)} • נכון ל־${dayMonth(today)} • ${String(rows.length)} קבועים`,
    currency: rows[0]?.currency ?? "ILS",
    outflow: monthOutflow(lines),
    inflow: monthInflow(lines),
    late,
    groups,
  };
}

/** The usual day in the due month, YYYY-MM-DD. */
function usualDayOf(row: ScheduleRow): string {
  return `${row.next_due_month}-${String(row.typical_day).padStart(2, "0")}`;
}

/**
 * The row's state in words (FLOW-1048), next to its mark: the lateness of a late charge, "שולם" or "התקבל" once it
 * came, and otherwise the soon hint or "צפוי ב־dd/mm".
 */
function statusWords(row: ScheduleRow, hint: string | undefined, late: boolean): string {
  if (row.state === "arrived") return row.direction === "income" ? "התקבל" : "שולם";
  if (late && hint != null) return hint;
  if (row.state === "soon" && hint != null) return hint;
  return `צפוי ב־${dayMonth(usualDayOf(row))}`;
}

/**
 * The one extra line a row may carry: "באיחור N ימים" for a late charge (counted from its usual day),
 * "▲ N%" when it arrived 20% or more above its usual amount, or, for a charge due this month whose day
 * has come but which is not late yet, "בדרך כלל היום" or "עוד לא הגיע · N ימים" (grey). Only bad news is red.
 */
function hintFor(row: ScheduleRow, line: RecurringLine, today: string, dismissed: boolean): Pick<RecurringListRow, "hint" | "alert"> {
  if (row.state === "late") {
    if (dismissed) return {};
    return { hint: `באיחור ${String(daysBetween(usualDayOf(row), today))} ימים`, alert: true };
  }
  if (row.state === "soon") {
    const days = daysBetween(usualDayOf(row), today);
    if (days === 0) return { hint: "בדרך כלל היום" };
    if (days > 0) return { hint: `עוד לא הגיע · ${days === 1 ? "יום אחד" : `${String(days)} ימים`}` };
  }
  if (row.state === "arrived" && comparable(row) && line.usual > 0n && line.minor * 100n >= line.usual * 120n) {
    return { hint: `▲ ${String(changePercentOf(line.minor, line.usual))}%`, alert: true };
  }
  return {};
}

/** The suggestion as the list shows it: its day as dd/mm, its amount still in minor units. */
function suggestionRow(suggestion: NonNullable<RecurringAlert["suggestion"]>): NonNullable<RecurringListRow["suggestion"]> {
  return { name: suggestion.party_name ?? "", partyId: suggestion.party_id, minor: suggestion.amount_minor, date: dayMonth(suggestion.doc_date) };
}

/**
 * FLOW-1011 (owner, 2026-11-01: "add the ability to add it from the recurring screen"): הוספת קבוע, at the end of the
 * list (V3-Recurring), and on the empty screen too (FLOW-1014). It asks which project (כללי is the overhead project), as
 * the תזרים צפוי screen does, then opens that project's add page for this month at כל חודש, which comes back here. Its
 * reads are its own, so a sample list (stories, tests) reads nothing.
 */
function RecurringAddLine({ month, search }: { month: string; search: string }) {
  const projects = useDashboardQuery(true);
  const overhead = useOverheadProject(true);
  if (!addLineReady(true, projects.data != null, overhead)) return null;
  return (
    <ForecastAddLine
      month={month}
      projects={lineProjects(projects.data?.projects ?? [], overhead.project?.id ?? null)}
      search={search}
      back="recurring"
      pace="month"
      label="הוספת קבוע"
    />
  );
}
