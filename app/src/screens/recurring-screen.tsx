import type { MissingBill } from "@flow/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMissingBillsQuery } from "../forecast";
import { useHomePreview } from "../preview";
import { liveRecurringWrites, type RecurringWrites } from "../recurring-actions";
import { groupRecurring, monthOutflow, type RecurringLine } from "../recurring-layout";
import { alertState, type RecurringAlert, type ScheduleRow, scheduleLines, useRecurringScheduleQuery } from "../recurring-schedule";
import { ErrorState } from "../ui/error-state";
import { type RecurringListGroup, type RecurringListRow, RecurringList } from "../ui/recurring-list";
import { RecurringSkeleton } from "../ui/screen-skeletons";
import { useToast } from "../ui/toast";

/** The keys an alert write changes: the schedule, the late bills, Home's rows and the party's history. */
const RECURRING_KEYS = ["recurring-schedule", "missing-bills", "recurring-changes", "expected-months", "party-charges", "home"];

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

const NO_ROWS: readonly ScheduleRow[] = [];

/** The dev fixture's writes: nothing reaches the server. */
const NO_WRITES: RecurringWrites = {
  dismiss: () => Promise.resolve(),
  restore: () => Promise.resolve(),
};

/** The alert state a screen computes from the schedule and the late bills. */
type AlertState = ReturnType<typeof alertState>;

/** "dd/mm" from a YYYY-MM-DD day. */
function dayMonth(day: string): string {
  const [, month = "", date = ""] = day.split("-");
  return `${date}/${month}`;
}

/** Search on the charge's supplier (FLOW-403's link); the name is the query. */
function searchHref(name: string): string {
  return `/search?q=${encodeURIComponent(name)}`;
}

/**
 * FLOW-447: the קבועים list. Late bills lead; the rest group by category, in the server's order.
 * `?project=` narrows it to one project (FLOW-424); an unknown id shows an empty list.
 * FLOW-447b: a late bill is ignored by a swipe or its button; a suggestion shows its name only (the answer is on the charge page, 447c). The dev
 * fixture (`sample`) keeps its own late bills in state and writes nothing.
 */
export function RecurringScreen({
  now = new Date(),
  sample,
  missing,
  failed = false,
  writes,
  openId,
}: {
  now?: Date;
  sample?: readonly ScheduleRow[];
  /** The dev fixture's late bills (`missing_bills`); undefined is a failed read. */
  missing?: readonly MissingBill[];
  /** The dev fixture's failed schedule read. */
  failed?: boolean;
  writes?: RecurringWrites;
  /** The dev fixture's row that opens over its action at first. */
  openId?: string;
} = {}) {
  const [params] = useSearchParams();
  const project = params.get("project");
  // ?preview= has no server: the loading preview keeps the skeleton, the others show an empty list.
  const preview = useHomePreview();
  const live = sample == null;
  const query = useRecurringScheduleQuery(live && preview === "off");
  const lateBills = useMissingBillsQuery(live);
  const [sampleBills, setSampleBills] = useState(missing);
  const client = useQueryClient();
  const toast = useToast();
  const writer = writes ?? (live ? liveRecurringWrites : NO_WRITES);
  const bills = live ? lateBills.data : sampleBills;
  const rows = sample ?? (preview === "off" ? query.data : preview === "loading" ? undefined : NO_ROWS);
  const today = israelToday(now);
  const alerts = useMemo(() => (rows == null ? undefined : alertState(rows, bills)), [rows, bills]);
  const view = useMemo(() => (rows == null ? null : recurringView(rows, today, project, alerts)), [rows, today, project, alerts]);

  const failedNow = live ? query.isError && query.data == null : failed;
  if (failedNow) {
    return (
      <div className="ui-recurring">
        <header className="ui-recurring-head">
          <h1 className="t-display">קבועים</h1>
        </header>
        <ErrorState offline={!navigator.onLine} onRetry={() => void (live ? query.refetch() : undefined)} />
      </div>
    );
  }
  if (view == null) return sample == null ? <RecurringSkeleton /> : null;

  /** Changes the late bills on screen at once: the cache when live, the fixture's state otherwise. */
  const editBills = (update: (list: readonly MissingBill[]) => MissingBill[]) => {
    if (live) client.setQueryData<MissingBill[]>(["missing-bills", preview], (old) => (old == null ? old : update(old)));
    else setSampleBills((old) => (old == null ? old : update(old)));
  };
  const refresh = () => {
    for (const key of RECURRING_KEYS) void client.invalidateQueries({ queryKey: [key] });
  };
  const failure = () => toast.show({ message: "לא הצלחנו לעדכן את השורה." });

  async function ignore(row: RecurringListRow, alertKey: string) {
    const removed = (bills ?? []).filter((bill) => bill.party_id === row.id);
    editBills((list) => list.filter((bill) => bill.party_id !== row.id));
    try {
      await writer.dismiss(alertKey);
    } catch {
      editBills((list) => [...list, ...removed]);
      failure();
      return;
    }
    refresh();
    toast.show({ message: "התעלמת מההתראה", action: "ביטול", onAction: () => void restore(row, alertKey, removed) });
  }

  async function restore(row: RecurringListRow, alertKey: string, removed: readonly MissingBill[]) {
    editBills((list) => [...list, ...removed]);
    try {
      await writer.restore(alertKey);
    } catch {
      editBills((list) => list.filter((bill) => bill.party_id !== row.id));
      failure();
      return;
    }
    refresh();
  }

  return (
    <RecurringList
      {...view}
      openId={openId}
      onIgnore={(row) => {
        if (row.alertKey != null) void ignore(row, row.alertKey);
      }}
    />
  );
}

/**
 * The list's props from the server rows, for the project when one is named. The outflow counts every
 * charge; a late charge leaves its group's rows (it leads the list) but still counts in its group's
 * monthly cost, as the board does.
 */
export function recurringView(allRows: readonly ScheduleRow[], today: string, project: string | null = null, alerts?: AlertState) {
  const rows = project == null ? allRows : allRows.filter((row) => row.project_id === project);
  const projectName = project == null ? undefined : allRows.find((row) => row.project_id === project)?.project_name ?? undefined;
  const lines = scheduleLines(rows);
  const byId = new Map(rows.map((row) => [row.party_id, row] as const));
  // A late charge that still alerts leads the list; one the user ignored is an ordinary row again.
  const state = alerts ?? alertState(rows, undefined);
  const lateIds = new Set(rows.filter((row) => row.state === "late" && state.active.has(row.party_id)).map((row) => row.party_id));
  const toRow = (line: RecurringLine): RecurringListRow => {
    const row = byId.get(line.id);
    if (row == null) throw new Error("recurring row");
    const alert: RecurringAlert | undefined = state.active.get(line.id);
    return {
      id: row.party_id,
      name: row.party_name,
      // The place is the project; a charge with no project shows its category instead.
      place: row.project_name || row.category_name || null,
      income: line.income,
      paid: line.arrived,
      minor: line.minor,
      ...hintFor(row, line, today, state.dismissed.has(line.id)),
      ...(alert == null ? {} : { alertKey: alert.alertKey, suggestion: alert.suggestion == null ? null : suggestionRow(alert.suggestion) }),
      ...(lateIds.has(line.id) ? { href: searchHref(row.party_name) } : {}),
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
    project: projectName,
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
function hintFor(row: ScheduleRow, line: RecurringLine, today: string, dismissed: boolean): Pick<RecurringListRow, "hint" | "alert"> {
  if (row.state === "late") {
    if (dismissed) return {};
    const usualDay = `${row.next_due_month}-${String(row.typical_day).padStart(2, "0")}`;
    return { hint: `באיחור ${String(daysBetween(usualDay, today))} ימים`, alert: true };
  }
  if (row.state === "arrived" && line.usual > 0n && line.minor * 100n >= line.usual * 120n) {
    const percent = Math.round(Number(((line.minor - line.usual) * 10000n) / line.usual) / 100);
    return { hint: `▲ ${String(percent)}%`, alert: true };
  }
  return {};
}

/** The suggestion as the list shows it: its day as dd/mm, its amount still in minor units. */
function suggestionRow(suggestion: NonNullable<RecurringAlert["suggestion"]>): NonNullable<RecurringListRow["suggestion"]> {
  return { name: suggestion.party_name ?? "", partyId: suggestion.party_id, minor: suggestion.amount_minor, date: dayMonth(suggestion.doc_date) };
}
