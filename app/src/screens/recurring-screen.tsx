import "../ui/lazy.css";
import type { MissingBill } from "@flow/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMissingBillsQuery } from "../forecast";
import { useHomePreview, usePreviewSearch } from "../preview";
import { RECURRING_KEYS } from "../pace-write";
import { liveRecurringWrites, type RecurringWrites } from "../recurring-actions";
import { chargeHref, comparable, dayMonth, endedText } from "../recurring-charge";
import { groupRecurring, monthInflow, monthOutflow, type RecurringLine } from "../recurring-layout";
import { alertState, changePercentOf, daysBetween, isSplitParty, israelToday, rowId, type RecurringAlert, type ScheduleRow, scheduleLines, useRecurringScheduleQuery } from "../recurring-schedule";
import { EmptyState } from "../ui/empty-state";
import { PageLoadFailed, useOnline } from "../ui/band-states";
import { type RecurringListGroup, type RecurringListRow, RecurringList } from "../ui/recurring-list";
import { RecurringSkeleton } from "../ui/screen-skeletons";
import { useToast } from "../ui/toast";
import { RepeatIcon } from "../ui/icons";
import { topToast } from "../ui/top-toast";

/** "אוקטובר 2026" for the day's month. */
function monthTitle(today: string): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`));
}

const NO_ROWS: readonly ScheduleRow[] = [];

/** The dev fixture's writes: nothing reaches the server. */
const NO_WRITES: RecurringWrites = {
  dismiss: () => Promise.resolve(),
  restore: () => Promise.resolve(),
  end: () => Promise.resolve(() => Promise.resolve()),
};

/** The alert state a screen computes from the schedule and the late bills. */
type AlertState = ReturnType<typeof alertState>;

/** No recurring charge yet: the title and the one line of what will show here (FLOW-447c, StatesRecurringEmpty). */
function RecurringEmpty() {
  return (
    <div className="ui-recurring">
      <header className="ui-recurring-head">
        <h1 className="t-title">קבועים</h1>
      </header>
      <EmptyState icon={<RepeatIcon />} title="עוד Flow לומד" body="חיובים והכנסות שחוזרים כל חודש יופיעו כאן אחרי חודשיים של תנועות. אפשר גם לסמן שורה כקבועה מדף התנועה." />
    </div>
  );
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
  offlineSince,
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
  const [sampleBills, setSampleBills] = useState(missing);
  const client = useQueryClient();
  const toast = useToast();
  const writer = writes ?? (live ? liveRecurringWrites : NO_WRITES);
  const bills = live ? lateBills.data : sampleBills;
  const rows = sample ?? (preview === "off" ? query.data : preview === "loading" ? undefined : NO_ROWS);
  const today = israelToday(now);
  const alerts = useMemo(() => (rows == null ? undefined : alertState(rows, bills)), [rows, bills]);
  const search = usePreviewSearch();
  const view = useMemo(() => (rows == null ? null : recurringView(rows, today, project, alerts, search)), [rows, today, project, alerts, search]);
  // The row whose "הסתיים" is still writing: a second tap on it sends nothing.
  const ending = useRef<string | null>(null);
  const online = useOnline();

  const failedNow = live ? query.isError && query.data == null : failed;
  if (failedNow) {
    // FLOW-963: the failure keeps the title and says what happened, with the retry and the way to help.
    return (
      <div className="ui-recurring">
        <header className="ui-recurring-head">
          <h1 className="t-title">קבועים</h1>
        </header>
        <PageLoadFailed title="הקבועים לא נטענו" offline={!online} onRetry={() => void (live ? query.refetch() : undefined)} />
      </div>
    );
  }
  if (view == null) return sample == null ? <RecurringSkeleton /> : null;
  if (rows != null && rows.length === 0 && project == null) return <RecurringEmpty />;

  /** Changes the late bills on screen at once: the cache when live, the fixture's state otherwise. */
  const editBills = (update: (list: readonly MissingBill[]) => MissingBill[]) => {
    if (live) client.setQueryData<MissingBill[]>(["missing-bills", preview], (old) => (old == null ? old : update(old)));
    else setSampleBills((old) => (old == null ? old : update(old)));
  };
  const refresh = () => {
    for (const key of RECURRING_KEYS) void client.invalidateQueries({ queryKey: [key] });
  };
  const failure = () => toast.show(topToast({ message: "לא הצלחנו לעדכן את השורה." }));

  /** An ignore, or the ask's "כן, עדיין קבוע": the late alert is set aside until the next late bill. */
  async function ignore(alertKey: string, message = "התעלמת מההתראה") {
    const removed = (bills ?? []).filter((bill) => bill.alert_key === alertKey);
    editBills((list) => list.filter((bill) => bill.alert_key !== alertKey));
    try {
      await writer.dismiss(alertKey);
    } catch {
      editBills((list) => [...list, ...removed]);
      failure();
      return;
    }
    refresh();
    toast.show(topToast({ message, action: "ביטול", onAction: () => void restore(alertKey, removed) }));
  }

  /** The ask's "הסתיים": the charge leaves the list and the forecast; the undo brings it back. */
  async function end(row: RecurringListRow) {
    const charge = rows?.find((item) => rowId(rows, item) === row.id);
    if (charge == null || ending.current === row.id) return;
    const split = isSplitParty(rows ?? [], charge);
    // The charge's own line, so the switch is that charge's (decision 0188), split or not.
    const target = { direction: charge.direction, partyId: charge.party_id, currency: charge.currency, projectId: charge.project_id };
    ending.current = row.id;
    let undo: () => Promise<void>;
    try {
      undo = await writer.end(target);
    } catch {
      failure();
      return;
    } finally {
      ending.current = null;
    }
    refresh();
    toast.show(topToast({
      // The switch is the charge's: ending a split party's charge ends that project's alone.
      message: endedText(charge.party_name, split ? (charge.project_name ?? "ללא פרויקט") : null),
      action: "ביטול",
      onAction: () => {
        void undo().then(refresh, failure);
      },
    }));
  }

  async function restore(alertKey: string, removed: readonly MissingBill[]) {
    editBills((list) => [...list, ...removed]);
    try {
      await writer.restore(alertKey);
    } catch {
      editBills((list) => list.filter((bill) => bill.alert_key !== alertKey));
      failure();
      return;
    }
    refresh();
  }

  // Offline with rows on screen: they are from the last read (FLOW-963).
  const since = live ? (online ? undefined : query.dataUpdatedAt || undefined) : offlineSince;
  return (
    <RecurringList
      {...view}
      openId={openId}
      offlineSince={since}
      onIgnore={(row) => {
        if (row.alertKey != null) void ignore(row.alertKey);
      }}
      onStill={(row) => {
        if (row.alertKey != null) void ignore(row.alertKey, "נמשיך לצפות לו");
      }}
      onEnded={(row) => void end(row)}
    />
  );
}

/**
 * The list's props from the server rows, for the project when one is named. The outflow counts every
 * charge; a late charge leaves its group's rows (it leads the list) but still counts in its group's
 * monthly cost, as the board does.
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
    return {
      id: line.id,
      name: row.party_name,
      // The place is the project; a charge with no project shows its category instead.
      place: row.project_name || row.category_name || null,
      income: line.income,
      paid: line.arrived,
      minor: line.minor,
      ...hintFor(row, line, today, state.dismissed.has(line.id)),
      ...(alert == null ? {} : { alertKey: alert.alertKey, suggestion: alert.suggestion == null ? null : suggestionRow(alert.suggestion) }),
      // A late charge with no match to offer asks whether it still recurs (the board's "עדיין קבוע?").
      ...(alert != null && alert.alertKey != null && alert.suggestion == null && row.state === "late" ? { ask: lateAskText(row) } : {}),
      href: chargeHref(row.direction, row.party_id, search, isSplitParty(allRows, row) ? row.project_id : null),
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

/** The ask under a late row: "לא שולם ב־03/10. עדיין קבוע?" (income: לא התקבל). */
function lateAskText(row: ScheduleRow): string {
  return `${row.direction === "income" ? "לא התקבל ב־" : "לא שולם ב־"}${dayMonth(usualDayOf(row))}. עדיין קבוע?`;
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
