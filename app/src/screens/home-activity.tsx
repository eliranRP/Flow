import { formatAmountText, type CashLine } from "@flow/shared";
import { Fragment, useEffect, type ReactNode } from "react";
import { chargeHref } from "../recurring-charge";
import { forecastKeyOf } from "../forecast-skip";
import { isSplitParty, rowId, type ScheduleRow } from "../recurring-schedule";
import { Button } from "../ui/button";
import { formatDayMonth } from "../ui/date-math";
import { DockSlot } from "../ui/dock-filter";
import { EmptyState } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { AlertIcon, CalendarIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { SegmentedControl } from "../ui/segmented-control";
import { StatusMark, type StatusMarkKind } from "../ui/status-mark";
import { SwipeRow } from "../ui/swipe-row";
import { monthName, type HomeFutureFigureRows } from "./home-parts";

/**
 * FLOW-1036 (board V3-Home, "תנועות החודש"): the month's activity on Home, under the attention cards. A filter
 * (הכול / קבועים / נותר לשלם) and three groups: what is still due from the recurring schedule, the recurring
 * charges that arrived, and the month's one-off lines (FLOW-1035's `recurring = false`). The grouping is pure;
 * HomeScreen supplies the reads.
 */

/** "left" is the current month's (נותר לשלם); "once" a past month's (חד-פעמי): a closed month has nothing due. */
export type ActivityFilter = "all" | "fixed" | "left" | "once";

type FilterOption = { value: ActivityFilter; label: string };

const ACTIVITY_FILTERS: FilterOption[] = [
  { value: "all", label: "הכול" },
  { value: "fixed", label: "קבועים" },
  { value: "left", label: "נותר לשלם" },
];

/** FLOW-1056: a past month's filter. */
const PAST_FILTERS: FilterOption[] = [
  { value: "all", label: "הכול" },
  { value: "fixed", label: "קבועים" },
  { value: "once", label: "חד-פעמי" },
];

/** The filter a month shows: one the month does not have (a past month's חד-פעמי on this month) reads as הכול. */
export function monthFilter(filter: ActivityFilter, past: boolean): ActivityFilter {
  return (past ? PAST_FILTERS : ACTIVITY_FILTERS).some((option) => option.value === filter) ? filter : "all";
}

export type ActivityGroupId = "left" | "skipped" | "paid" | "once";

const GROUP_TITLES: Record<ActivityGroupId, string> = { left: "נותר לשלם", skipped: "הוצא מהצפי", paid: "קבועים ששולמו", once: "חד-פעמי" };

export type ActivityRow = {
  key: string;
  title: string;
  meta: string;
  mark: StatusMarkKind;
  /** Unsigned, in the row's currency. */
  minor: bigint;
  currency: string;
  /** Money in: green with + (muted while still due). */
  income: boolean;
  /** FLOW-1056: none for a forecast row with nothing to edit (a general row with no overhead project, a loan's principal). */
  href?: string;
  /** FLOW-1056: a forecast's loan principal, kept out of profit: faded, as the צפי page draws it. */
  setAside?: boolean;
  /** FLOW-1079: a recurring charge's forecast item, which a swipe takes out of this month's forecast or puts back. */
  forecastKey?: string;
};

export type ActivityGroup = {
  /** The month's groups ("left", "paid", "once"); on next month (FLOW-1056) a project's id, or "general". */
  id: string;
  title: string;
  rows: ActivityRow[];
  /** The group's money out and in, in the base currency (rows in another currency are not added). */
  outMinor: bigint;
  inMinor: bigint;
  /** Its sums are still to come: "לתשלום" and "להיכנס", not "יצא" and "נכנס". */
  due: boolean;
};

/** FLOW-1056: Home on next month: its forecast's band figures and its expected rows, grouped by project. */
export type HomeFuture = {
  phase: "loading" | "failed" | "ready";
  /** A failed read waits for the network. */
  offline: boolean;
  onRetry: () => void;
  /** Null until the forecast is read. */
  figures: HomeFutureFigureRows | null;
  groups: ActivityGroup[];
};

/** What Home has read for the activity: null while a read is out. */
export type HomeActivityData = {
  schedule: readonly ScheduleRow[] | null;
  scheduleFailed: boolean;
  /** The month's base-currency lines, both sides (their first page). */
  lines: readonly CashLine[] | null;
  linesFailed: boolean;
  onRetry: () => void;
  /**
   * FLOW-1056 (owner): a past month: its lines alone (no schedule), grouped קבועים and חד-פעמי, under a title with the
   * month's totals. `more`: the lines run past their first page, so the list ends with a row to the month's lines.
   */
  past?: { more: boolean } | null;
};

/** FLOW-1056: a past month's close, for the activity's title: what came in and went out, and its lines page. */
export type PastMonthClose = { name: string; inMinor: bigint; outMinor: bigint; linesHref: string };

function magnitude(minor: bigint | number): bigint {
  const value = BigInt(minor);
  return value < 0n ? -value : value;
}

/**
 * The schedule's rows this month: still due (late first, then by day) and arrived. Rows due in a later month stay out.
 * FLOW-1079: a due row taken out of this month's forecast (`skipped`, by forecast key) is in `skipped` instead.
 */
export function scheduleActivity(
  schedule: readonly ScheduleRow[],
  search: string,
  skipped: ReadonlySet<string> = new Set(),
  monthLabel = "",
): { left: ActivityRow[]; skipped: ActivityRow[]; paid: ActivityRow[] } {
  const row = (item: ScheduleRow, mark: StatusMarkKind, meta: string, minor: number): ActivityRow => ({
    key: rowId(schedule, item),
    title: item.party_name,
    meta,
    mark,
    minor: magnitude(minor),
    currency: item.currency,
    income: item.direction === "income",
    href: chargeHref(item.direction, item.party_id, search, isSplitParty(schedule, item) ? item.project_id : null),
    forecastKey: forecastKeyOf(item, isSplitParty(schedule, item)),
  });
  const due = schedule
    .filter((item) => item.state === "late" || item.state === "soon")
    .sort((a, b) => Number(b.state === "late") - Number(a.state === "late") || a.typical_day - b.typical_day);
  const out = (item: ScheduleRow) => skipped.has(forecastKeyOf(item, isSplitParty(schedule, item)));
  const left = due.filter((item) => !out(item)).map((item) =>
    item.state === "late" ? row(item, "late", "איחר", item.typical_amount_minor) : row(item, "due", `צפוי ב־${String(item.typical_day)}`, item.typical_amount_minor),
  );
  const skippedRows = due.filter(out).map((item) => row(item, "due", `לא צפוי ב${monthLabel}`, item.typical_amount_minor));
  const paid = schedule
    .filter((item) => item.state === "arrived")
    .map((item) => row(item, "paid", [item.project_name, item.category_name].filter((part) => part != null && part !== "").join(" · ") || "קבוע", item.amount_minor ?? item.typical_amount_minor));
  return { left, skipped: skippedRows, paid };
}

/**
 * The month's one-off lines, newest first; null when the server does not say which lines are recurring
 * (before FLOW-1035, BUILD-PLAN §5): the group then hides, and nothing says data is missing.
 */
export function onceActivity(lines: readonly CashLine[], search: string): ActivityRow[] | null {
  if (!linesFlagged(lines)) return null;
  return lineRows(lines.filter((line) => line.recurring === false), "once", search);
}

/** Whether the server says which lines are recurring (FLOW-1035); an empty list says nothing either way. */
function linesFlagged(lines: readonly CashLine[]): boolean {
  return lines.length === 0 || lines.some((line) => line.recurring !== undefined);
}

/** Lines as activity rows, newest first, each opening its transaction. */
function lineRows(lines: readonly CashLine[], mark: StatusMarkKind, search: string): ActivityRow[] {
  return [...lines]
    .sort((a, b) => b.cash_month_date.localeCompare(a.cash_month_date))
    .map((line) => {
      // A credit on the out side (a refund) is money in, and a reversal on the in side is money out.
      const income = (line.side === "in") === line.amount_minor >= 0n;
      return {
        key: `${line.transaction_id}:${line.part ?? ""}:${line.side}`,
        title: line.supplier_name ?? line.description,
        meta: [formatDayMonth(line.cash_month_date), line.project_name].filter((part) => part != null && part !== "").join(" · "),
        mark,
        minor: magnitude(line.amount_minor),
        currency: line.currency,
        income,
        href: `/transactions/${line.transaction_id}${search}`,
      };
    });
}

/**
 * FLOW-1056 (owner): a past month's groups, from its lines alone: קבועים (the recurring lines that arrived, mark
 * paid) and חד-פעמי (the one-off lines), each only with rows; הכול shows both, the other two their own. Before the
 * server says which lines are recurring (BUILD-PLAN §5), every line is in one group, "תנועות", under הכול.
 */
export function pastActivityGroups({ lines, filter, base, search }: {
  lines: readonly CashLine[] | null;
  filter: ActivityFilter;
  base: string;
  search: string;
}): ActivityGroup[] {
  if (lines == null) return [];
  const made = (id: string, title: string, rows: ActivityRow[]): ActivityGroup => ({ id, title, rows, ...groupSums(rows, base), due: false });
  if (!linesFlagged(lines)) return filter === "all" && lines.length > 0 ? [made("lines", "תנועות", lineRows(lines, "once", search))] : [];
  const groups: ActivityGroup[] = [];
  if (filter !== "once") groups.push(made("fixed", "קבועים", lineRows(lines.filter((line) => line.recurring === true), "paid", search)));
  if (filter !== "fixed") groups.push(made("once", "חד-פעמי", lineRows(lines.filter((line) => line.recurring === false), "once", search)));
  return groups.filter((item) => item.rows.length > 0);
}

/** "נכנס $32,765 · יצא $66,940": how a past month finished, in the base currency, in a group summary's style. */
function MonthClose({ close, base }: { close: PastMonthClose; base: string }) {
  return (
    <p className="ui-home-act-close t-meta">
      נכנס <bdi dir="ltr">{formatAmountText(close.inMinor, base)}</bdi> · יצא <bdi dir="ltr">{formatAmountText(close.outMinor, base)}</bdi>
    </p>
  );
}

function group(id: ActivityGroupId, rows: ActivityRow[], base: string): ActivityGroup {
  return { id, title: GROUP_TITLES[id], rows, ...groupSums(rows, base), due: id === "left" || id === "skipped" };
}

/** A group's money out and in, in the base currency: a row in another currency is not added. */
export function groupSums(rows: readonly ActivityRow[], base: string): { outMinor: bigint; inMinor: bigint } {
  let outMinor = 0n;
  let inMinor = 0n;
  for (const row of rows) {
    if (row.currency !== base) continue;
    if (row.income) inMinor += row.minor;
    else outMinor += row.minor;
  }
  return { outMinor, inMinor };
}

/**
 * The groups the filter shows, each only when it has rows: הכול shows all three, קבועים hides חד-פעמי, and
 * נותר לשלם shows only its own. A read still out (null) adds nothing yet.
 */
export function activityGroups({ schedule, lines, filter, base, search, skipped, monthLabel = "" }: {
  schedule: readonly ScheduleRow[] | null;
  lines: readonly CashLine[] | null;
  filter: ActivityFilter;
  base: string;
  search: string;
  /** FLOW-1079: the month's charges taken out of the forecast, by forecast key. */
  skipped?: ReadonlySet<string>;
  monthLabel?: string;
}): ActivityGroup[] {
  const fixed = schedule == null ? { left: [], skipped: [], paid: [] } : scheduleActivity(schedule, search, skipped, monthLabel);
  const once = lines == null ? null : onceActivity(lines, search);
  // FLOW-1079: what was taken out sits right under what is still due, under the filters that show נותר לשלם.
  const groups = [group("left", fixed.left, base), group("skipped", fixed.skipped, base)];
  if (filter !== "left") groups.push(group("paid", fixed.paid, base));
  if (filter === "all" && once != null) groups.push(group("once", once, base));
  return groups.filter((item) => item.rows.length > 0);
}

/** "5 · $2,780 לתשלום": the count, then what goes out and what comes in, in the group's own words. */
function GroupSummary({ group: item, base }: { group: ActivityGroup; base: string }) {
  const due = item.due;
  const parts: ReactNode[] = [<bdi key="count" dir="ltr">{String(item.rows.length)}</bdi>];
  // FLOW-1079: what was taken out counts in no total; the head says so.
  if (item.id === "skipped") return <>{parts[0]} · לא בצפי של החודש</>;
  if (item.outMinor > 0n) parts.push(<span key="out"><bdi dir="ltr">{formatAmountText(item.outMinor, base)}</bdi>{due ? " לתשלום" : " יצא"}</span>);
  if (item.inMinor > 0n) parts.push(<span key="in"><bdi dir="ltr">{`+${formatAmountText(item.inMinor, base)}`}</bdi>{due ? " להיכנס" : " נכנס"}</span>);
  return <>{parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))}</>;
}

/** The filter, in the page (tone page) and docked in the band's bar (tone band): one state, two places. */
export function ActivityFilterControl({ value, onChange, tone, past = false }: { value: ActivityFilter; onChange: (value: ActivityFilter) => void; tone: "page" | "band"; past?: boolean }) {
  return <SegmentedControl label="סינון תנועות" showLabel={false} tone={tone} value={monthFilter(value, past)} options={past ? PAST_FILTERS : ACTIVITY_FILTERS} onChange={onChange} />;
}

const EMPTY: Record<ActivityFilter, { title: string; body: string }> = {
  all: { title: "עוד אין תנועות החודש", body: "קבועים ותנועות מהבנק יופיעו כאן כשיגיעו." },
  fixed: { title: "אין קבועים החודש", body: "Flow מזהה לבד שכירות, משכנתא וחשבונות שחוזרים." },
  left: { title: "אין מה לשלם עוד החודש", body: "כל הקבועים של החודש הגיעו." },
  once: { title: "אין תנועות חד-פעמיות", body: "כל התנועות של החודש היו קבועים." },
};

/** FLOW-1056: a past month's empty list, by filter. */
function pastEmpty(filter: ActivityFilter, name: string): { title: string; body: string } {
  if (filter === "fixed") return { title: `אין קבועים ב${name}`, body: "לא הגיעו חיובים או הכנסות קבועים בחודש הזה." };
  if (filter === "once") return EMPTY.once;
  return { title: `אין תנועות ב${name}`, body: "לא נכנס ולא יצא כסף בחודש הזה." };
}

/**
 * The section: the mark the dock watches, the in-page filter (it fades while docked), then the groups with their
 * sticky one-line heads. A failed read says so with a retry and keeps what loaded; the band above it stays.
 * FLOW-1056: on a past month (`activity.past`, with `close`), its lines alone under "הפעילות ב<month>" and the
 * month's totals, and the filter הכול / קבועים / חד-פעמי; a list past its first page ends with the month's lines.
 */
/**
 * FLOW-1079: the current month's swipes. A row in נותר לשלם swipes to "לא החודש" (out of this month's forecast); a row
 * under הוצא מהצפי swipes to "החזרה". `peek`: the first row slides open and back once, the first time (per phone).
 */
export type ActivitySkip = {
  skipped: ReadonlySet<string>;
  monthLabel: string;
  onSkip: (row: ActivityRow) => void;
  onRestore: (row: ActivityRow) => void;
  peek: boolean;
  onPeeked: () => void;
};

export function HomeActivity({ activity, filter: picked, onFilter, markRef, docked, base, search, recurringHref, close = null, skip }: {
  activity: HomeActivityData;
  filter: ActivityFilter;
  onFilter: (value: ActivityFilter) => void;
  markRef: (node: HTMLElement | null) => void;
  docked: boolean;
  base: string;
  search: string;
  /** FLOW-1017: the recurring screen by name, so the band's icon is not the only way there. */
  recurringHref: string;
  /** FLOW-1056: a past month's name, totals and lines page. */
  close?: PastMonthClose | null;
  /** FLOW-1079: the current month's swipes; none for a viewer, a preview and other months. */
  skip?: ActivitySkip;
}) {
  const past = activity.past != null;
  const filter = monthFilter(picked, past);
  const groups = past
    ? pastActivityGroups({ lines: activity.lines, filter, base, search })
    : activityGroups({ schedule: activity.schedule, lines: activity.lines, filter, base, search, skipped: skip?.skipped, monthLabel: skip?.monthLabel });
  const failed = activity.scheduleFailed || activity.linesFailed;
  const loading = past ? activity.lines == null && !failed : activity.schedule == null && !activity.scheduleFailed;
  const empty = past ? pastEmpty(filter, close?.name ?? "") : EMPTY[filter];
  return (
    <section className="ui-home-act" aria-labelledby="home-act-title">
      {past && close != null ? (
        <div className="ui-home-act-head">
          <h2 id="home-act-title" className="ui-home-act-title t-section">{`הפעילות ב${close.name}`}</h2>
          <MonthClose close={close} base={base} />
        </div>
      ) : (
        <h2 id="home-act-title" className="sr-only">תנועות החודש</h2>
      )}
      <span ref={markRef} className="ui-compact-mark" />
      <DockSlot docked={docked}>
        <ActivityFilterControl value={filter} onChange={onFilter} tone="page" past={past} />
      </DockSlot>
      {failed ? (
        <ActivityFailed title="רשימת התנועות לא נטענה" offline={false} onRetry={activity.onRetry} />
      ) : null}
      {loading ? (
        <List layout="flat" className="ui-home-act-skel">
          <ListRow variant="skeleton" layout="flat" icon />
          <ListRow variant="skeleton" layout="flat" icon />
          <ListRow variant="skeleton" layout="flat" icon />
        </List>
      ) : groups.length === 0 ? (
        failed ? null : <EmptyState icon={<CalendarIcon />} title={empty.title} body={empty.body} />
      ) : (
        <ActivityGroups groups={groups} base={base} skip={past ? undefined : skip} />
      )}
      {past ? (
        activity.past?.more === true && close != null && !loading ? (
          <div className="ui-home-act-foot">
            <Button variant="link" to={close.linesHref} chevron>
              {`כל התנועות ב${close.name}`}
            </Button>
          </div>
        ) : null
      ) : (
        <div className="ui-home-act-foot">
          <Button variant="link" to={recurringHref} chevron>
            כל הקבועים
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * FLOW-1052 (V3-States, "שגיאה"): a part of Home that did not load is one 52px card: the signal's mark, what did not
 * load, and נסו שוב. Offline says so after the title. What else loaded stays.
 */
function ActivityFailed({ title, offline, onRetry }: { title: string; offline: boolean; onRetry: () => void }) {
  return (
    <div className="ui-home-act-failed" role="alert">
      <span className="ui-home-act-failed-mark" aria-hidden="true">
        <AlertIcon size={18} />
      </span>
      <span className="ui-home-act-failed-title t-line2">{offline ? `${title} · אין חיבור לאינטרנט` : title}</span>
      <Button variant="link" onClick={onRetry}>
        נסו שוב
      </Button>
    </div>
  );
}

/** The groups under their sticky one-line heads, each row with its status mark. */
function ActivityGroups({ groups, base, skip }: { groups: readonly ActivityGroup[]; base: string; skip?: ActivitySkip }) {
  const firstLeft = groups.find((item) => item.id === "left")?.rows[0]?.key;
  return groups.map((item) => (
    <section key={item.id} className="ui-month ui-home-act-group" aria-labelledby={`home-act-${item.id}`}>
      <GroupHead id={`home-act-${item.id}`} title={item.title} summary={<GroupSummary group={item} base={base} />} />
      <List layout="flat">
        {item.rows.map((row) => {
          const line = <ActivityLine row={row} skipped={item.id === "skipped"} />;
          const swipes = skip != null && row.forecastKey != null && (item.id === "left" || item.id === "skipped");
          if (!swipes) return <Fragment key={row.key}>{line}</Fragment>;
          const restore = item.id === "skipped";
          const peek = !restore && skip.peek && row.key === firstLeft;
          return (
            <Fragment key={row.key}>
              <SwipeRow
                label={restore ? "החזרה לצפי" : "לא החודש"}
                peek={peek}
                onRemove={() => {
                  if (restore) skip.onRestore(row);
                  else skip.onSkip(row);
                }}
              >
                {line}
              </SwipeRow>
              {peek ? <PeekSeen onSeen={skip.onPeeked} /> : null}
            </Fragment>
          );
        })}
      </List>
    </section>
  ));
}

/** Marks the one-time swipe hint seen once it has shown (the row's peek runs on mount). */
function PeekSeen({ onSeen }: { onSeen: () => void }) {
  useEffect(() => {
    onSeen();
  }, [onSeen]);
  return null;
}

/** One activity row: its status mark, name and line, and its amount. */
function ActivityLine({ row, skipped }: { row: ActivityRow; skipped: boolean }) {
  return (
          <ListRow
            layout="flat"
            variant="transaction"
            className={skipped ? "ui-home-act-skipped" : row.mark === "due" || row.mark === "late" ? "ui-home-act-due" : undefined}
            title={row.title}
            hint={row.meta}
            tone={row.mark === "late" ? "warning" : undefined}
            icon={<StatusMark kind={row.mark} />}
            agorot={row.minor}
            currency={row.currency}
            sign={row.income ? "in" : "cost"}
            source="bank"
            setAside={row.setAside}
            href={row.href}
          />
  );
}

/**
 * FLOW-1056: next month's activity on Home: "הצפוי בדצמבר", then the forecast's rows by project (the company צפי
 * page's parts, in the Projects tab's order, the general costs last), each due. No filter: הכול, קבועים and
 * נותר לשלם sort what has moved, and nothing has yet. Loading, failed (the band stays) and nothing expected.
 */
export function HomeFutureActivity({ monthKey, future, base }: { monthKey: string; future: HomeFuture; base: string }) {
  const name = monthName(monthKey);
  return (
    <section className="ui-home-act" aria-labelledby="home-act-title" aria-busy={future.phase === "loading" || undefined}>
      <h2 id="home-act-title" className="ui-home-act-title t-section">{`הצפוי ב${name}`}</h2>
      {future.phase === "failed" ? (
        <ActivityFailed title={`הצפי ל${name} לא נטען`} offline={future.offline} onRetry={future.onRetry} />
      ) : future.phase === "loading" ? (
        <List layout="flat" className="ui-home-act-skel">
          <ListRow variant="skeleton" layout="flat" icon />
          <ListRow variant="skeleton" layout="flat" icon />
          <ListRow variant="skeleton" layout="flat" icon />
        </List>
      ) : future.groups.length === 0 ? (
        <EmptyState icon={<CalendarIcon />} title={`אין עוד צפי ל${name}`} body="קבועים, ממוצעים ותשלומי הלוואות יופיעו כאן כשיהיו." />
      ) : (
        <ActivityGroups groups={future.groups} base={base} />
      )}
    </section>
  );
}
