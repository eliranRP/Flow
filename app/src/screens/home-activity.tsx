import { formatAmountText, type CashLine } from "@flow/shared";
import type { ReactNode } from "react";
import { chargeHref } from "../recurring-charge";
import { isSplitParty, rowId, type ScheduleRow } from "../recurring-schedule";
import { Button } from "../ui/button";
import { formatDayMonth } from "../ui/date-math";
import { DockSlot } from "../ui/dock-filter";
import { EmptyState, FailureLine } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { CalendarIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { SegmentedControl } from "../ui/segmented-control";
import { StatusMark, type StatusMarkKind } from "../ui/status-mark";

/**
 * FLOW-1036 (board V3-Home, "תנועות החודש"): the month's activity on Home, under the attention cards. A filter
 * (הכול / קבועים / נותר לשלם) and three groups: what is still due from the recurring schedule, the recurring
 * charges that arrived, and the month's one-off lines (FLOW-1035's `recurring = false`). The grouping is pure;
 * HomeScreen supplies the reads.
 */

export type ActivityFilter = "all" | "fixed" | "left";

export const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "הכול" },
  { value: "fixed", label: "קבועים" },
  { value: "left", label: "נותר לשלם" },
];

export type ActivityGroupId = "left" | "paid" | "once";

const GROUP_TITLES: Record<ActivityGroupId, string> = { left: "נותר לשלם", paid: "קבועים ששולמו", once: "חד-פעמי" };

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
  href: string;
};

export type ActivityGroup = {
  id: ActivityGroupId;
  title: string;
  rows: ActivityRow[];
  /** The group's money out and in, in the base currency (rows in another currency are not added). */
  outMinor: bigint;
  inMinor: bigint;
};

/** What Home has read for the activity: null while a read is out. */
export type HomeActivityData = {
  schedule: readonly ScheduleRow[] | null;
  scheduleFailed: boolean;
  /** The current month's base-currency lines, both sides. */
  lines: readonly CashLine[] | null;
  linesFailed: boolean;
  onRetry: () => void;
};

function magnitude(minor: bigint | number): bigint {
  const value = BigInt(minor);
  return value < 0n ? -value : value;
}

/** The schedule's rows this month: still due (late first, then by day) and arrived. Rows due in a later month stay out. */
export function scheduleActivity(schedule: readonly ScheduleRow[], search: string): { left: ActivityRow[]; paid: ActivityRow[] } {
  const row = (item: ScheduleRow, mark: StatusMarkKind, meta: string, minor: number): ActivityRow => ({
    key: rowId(schedule, item),
    title: item.party_name,
    meta,
    mark,
    minor: magnitude(minor),
    currency: item.currency,
    income: item.direction === "income",
    href: chargeHref(item.direction, item.party_id, search, isSplitParty(schedule, item) ? item.project_id : null),
  });
  const due = schedule
    .filter((item) => item.state === "late" || item.state === "soon")
    .sort((a, b) => Number(b.state === "late") - Number(a.state === "late") || a.typical_day - b.typical_day);
  const left = due.map((item) =>
    item.state === "late" ? row(item, "late", "איחר", item.typical_amount_minor) : row(item, "due", `צפוי ב־${String(item.typical_day)}`, item.typical_amount_minor),
  );
  const paid = schedule
    .filter((item) => item.state === "arrived")
    .map((item) => row(item, "paid", [item.project_name, item.category_name].filter((part) => part != null && part !== "").join(" · ") || "קבוע", item.amount_minor ?? item.typical_amount_minor));
  return { left, paid };
}

/**
 * The month's one-off lines, newest first; null when the server does not say which lines are recurring
 * (before FLOW-1035, BUILD-PLAN §5): the group then hides, and nothing says data is missing.
 */
export function onceActivity(lines: readonly CashLine[], search: string): ActivityRow[] | null {
  if (lines.length > 0 && lines.every((line) => line.recurring === undefined)) return null;
  return lines
    .filter((line) => line.recurring === false)
    .sort((a, b) => b.cash_month_date.localeCompare(a.cash_month_date))
    .map((line) => {
      // A credit on the out side (a refund) is money in, and a reversal on the in side is money out.
      const income = (line.side === "in") === line.amount_minor >= 0n;
      return {
        key: `${line.transaction_id}:${line.part ?? ""}:${line.side}`,
        title: line.supplier_name ?? line.description,
        meta: [formatDayMonth(line.cash_month_date), line.project_name].filter((part) => part != null && part !== "").join(" · "),
        mark: "once" as const,
        minor: magnitude(line.amount_minor),
        currency: line.currency,
        income,
        href: `/transactions/${line.transaction_id}${search}`,
      };
    });
}

function group(id: ActivityGroupId, rows: ActivityRow[], base: string): ActivityGroup {
  let outMinor = 0n;
  let inMinor = 0n;
  for (const row of rows) {
    if (row.currency !== base) continue;
    if (row.income) inMinor += row.minor;
    else outMinor += row.minor;
  }
  return { id, title: GROUP_TITLES[id], rows, outMinor, inMinor };
}

/**
 * The groups the filter shows, each only when it has rows: הכול shows all three, קבועים hides חד-פעמי, and
 * נותר לשלם shows only its own. A read still out (null) adds nothing yet.
 */
export function activityGroups({ schedule, lines, filter, base, search }: {
  schedule: readonly ScheduleRow[] | null;
  lines: readonly CashLine[] | null;
  filter: ActivityFilter;
  base: string;
  search: string;
}): ActivityGroup[] {
  const fixed = schedule == null ? { left: [], paid: [] } : scheduleActivity(schedule, search);
  const once = lines == null ? null : onceActivity(lines, search);
  const groups = [group("left", fixed.left, base)];
  if (filter !== "left") groups.push(group("paid", fixed.paid, base));
  if (filter === "all" && once != null) groups.push(group("once", once, base));
  return groups.filter((item) => item.rows.length > 0);
}

/** "5 · $2,780 לתשלום": the count, then what goes out and what comes in, in the group's own words. */
function GroupSummary({ group: item, base }: { group: ActivityGroup; base: string }) {
  const due = item.id === "left";
  const parts: ReactNode[] = [<bdi key="count" dir="ltr">{String(item.rows.length)}</bdi>];
  if (item.outMinor > 0n) parts.push(<span key="out"><bdi dir="ltr">{formatAmountText(item.outMinor, base)}</bdi>{due ? " לתשלום" : " יצא"}</span>);
  if (item.inMinor > 0n) parts.push(<span key="in"><bdi dir="ltr">{`+${formatAmountText(item.inMinor, base)}`}</bdi>{due ? " להיכנס" : " נכנס"}</span>);
  return <>{parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))}</>;
}

/** The filter, in the page (tone page) and docked in the band's bar (tone band): one state, two places. */
export function ActivityFilterControl({ value, onChange, tone }: { value: ActivityFilter; onChange: (value: ActivityFilter) => void; tone: "page" | "band" }) {
  return <SegmentedControl label="סינון תנועות" showLabel={false} tone={tone} value={value} options={ACTIVITY_FILTERS} onChange={onChange} />;
}

const EMPTY: Record<ActivityFilter, { title: string; body: string }> = {
  all: { title: "עוד אין תנועות החודש", body: "קבועים ותנועות מהבנק יופיעו כאן כשיגיעו." },
  fixed: { title: "אין קבועים החודש", body: "Flow מזהה לבד שכירות, משכנתא וחשבונות שחוזרים." },
  left: { title: "אין מה לשלם עוד החודש", body: "כל הקבועים של החודש הגיעו." },
};

/**
 * The section: the mark the dock watches, the in-page filter (it fades while docked), then the groups with their
 * sticky one-line heads. A failed read says so with a retry and keeps what loaded; the band above it stays.
 */
export function HomeActivity({ activity, filter, onFilter, markRef, docked, base, search, recurringHref }: {
  activity: HomeActivityData;
  filter: ActivityFilter;
  onFilter: (value: ActivityFilter) => void;
  markRef: (node: HTMLElement | null) => void;
  docked: boolean;
  base: string;
  search: string;
  /** FLOW-1017: the recurring screen by name, so the band's icon is not the only way there. */
  recurringHref: string;
}) {
  const groups = activityGroups({ schedule: activity.schedule, lines: activity.lines, filter, base, search });
  const loading = activity.schedule == null && !activity.scheduleFailed;
  const failed = activity.scheduleFailed || activity.linesFailed;
  return (
    <section className="ui-home-act" aria-labelledby="home-act-title">
      <h2 id="home-act-title" className="sr-only">תנועות החודש</h2>
      <span ref={markRef} className="ui-compact-mark" />
      <DockSlot docked={docked}>
        <ActivityFilterControl value={filter} onChange={onFilter} tone="page" />
      </DockSlot>
      {failed ? (
        <div className="ui-home-act-failed">
          <p className="ui-home-act-failed-title t-body">רשימת התנועות לא נטענה</p>
          <FailureLine offline={false} onRetry={activity.onRetry} />
        </div>
      ) : null}
      {loading ? (
        <List layout="flat" className="ui-home-act-skel">
          <ListRow variant="skeleton" layout="flat" icon />
          <ListRow variant="skeleton" layout="flat" icon />
          <ListRow variant="skeleton" layout="flat" icon />
        </List>
      ) : groups.length === 0 ? (
        failed ? null : <EmptyState icon={<CalendarIcon />} title={EMPTY[filter].title} body={EMPTY[filter].body} />
      ) : (
        groups.map((item) => (
          <section key={item.id} className="ui-month ui-home-act-group" aria-labelledby={`home-act-${item.id}`}>
            <GroupHead id={`home-act-${item.id}`} title={item.title} summary={<GroupSummary group={item} base={base} />} />
            <List layout="flat">
              {item.rows.map((row) => (
                <ListRow
                  key={row.key}
                  layout="flat"
                  variant="transaction"
                  className={row.mark === "due" || row.mark === "late" ? "ui-home-act-due" : undefined}
                  title={row.title}
                  hint={row.meta}
                  tone={row.mark === "late" ? "warning" : undefined}
                  icon={<StatusMark kind={row.mark} />}
                  agorot={row.minor}
                  currency={row.currency}
                  sign={row.income ? "in" : "cost"}
                  source="bank"
                  href={row.href}
                />
              ))}
            </List>
          </section>
        ))
      )}
      <div className="ui-home-act-foot">
        <Button variant="link" to={recurringHref} chevron>
          כל הקבועים
        </Button>
      </div>
    </section>
  );
}
