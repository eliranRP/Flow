import { formatAmountText } from "@flow/shared";
import { type ReactNode, useState } from "react";
import { usePreviewSearch } from "../preview";
import { AttentionCards } from "./attention-cards";
import { BandOfflineLine } from "./band-states";
import type { BannerRow } from "./banner";
import { EmptyState } from "./empty-state";
import { GroupHead } from "./group-head";
import { RepeatIcon } from "./icons";
import { List, ListRow } from "./list-row";
import { BackButton } from "./back";
import { CompactBar } from "./compact-bar";
import { DockSlot, useDockedFilter } from "./dock-filter";
import { FocusTitle } from "./focus-title";
import { DETAIL_BAR, useScrolledPast } from "./screen-header";
import { SegmentedControl } from "./segmented-control";
import { StatusMark, type StatusMarkKind } from "./status-mark";
import "./css/39-recurring.css";

/** The suggested party a late bill may be (decision 0179), as the list shows it. */
export type RecurringListSuggestion = {
  name: string;
  partyId: string;
  /** The suggested bill's amount. */
  minor: bigint;
  /** The bill's day, "dd/mm". */
  date: string;
};

/** One charge on the list, as the screen shows it. */
export type RecurringListRow = {
  id: string;
  name: string;
  /** The project, or the category when the charge has none; null for neither. */
  place: string | null;
  income: boolean;
  /** Paid this month: the primary text. Not paid yet: grey. */
  paid: boolean;
  minor: bigint;
  /** FLOW-1048: the row's mark (V3-Recurring): a dashed ring while due (signal when late), a check once paid. */
  mark: StatusMarkKind;
  /** FLOW-1048: the state in words, so the mark's colour is never the only cue ("באיחור 8 ימים", "צפוי ב־15/10", "שולם"). */
  status: string;
  /** "באיחור N ימים" for a late bill, or "▲ N%" for a change of 20% or more. */
  hint?: string;
  /** A bad-news hint, drawn in the danger colour. */
  alert?: boolean;
  /** FLOW-447b: the key an ignore takes, for a late bill that still alerts; null when unknown. */
  alertKey?: string | null;
  /** FLOW-447b: a late bill that may be another party under another name. */
  suggestion?: RecurringListSuggestion | null;
  /** FLOW-447c: where the row opens, the party's charge page. */
  href: string;
};

export type RecurringListGroup = {
  id: string;
  title: string;
  income: boolean;
  /** The group's monthly cost. */
  monthlyMinor: bigint;
  rows: RecurringListRow[];
};

export type RecurringListProps = {
  /** The project the list is narrowed to, named above the title. */
  project?: string;
  /** "אוקטובר 2026 • נכון ל־11/10 • 15 קבועים". */
  subtitle: string;
  currency: string;
  outflow: { total: bigint; paid: bigint; toCome: bigint };
  /** The month's recurring income: what came in and what is still to come. */
  inflow: { total: bigint; got: bigint; toCome: bigint };
  /** The bills late for their month: the "לא הגיעו" cards above the groups (they stay in their groups too). */
  late: RecurringListRow[];
  groups: RecurringListGroup[];
  /** FLOW-963: offline, the moment the rows on screen are from; undefined when online. */
  offlineSince?: number;
  /** FLOW-1011: the row that adds a recurring line to a project's forecast, at the end of the list (V3-Recurring). */
  addLine?: ReactNode;
};

/** FLOW-986: קבועים opens from Home, so Back goes there ("‹ בית"). */
function useHomeBack(): string {
  return `/${usePreviewSearch()}`;
}

/**
 * FLOW-1048 (V3-Recurring): the head every state of the screen keeps: Back to בית, the project when the list is one
 * project's, the title (32/600) and its line (14). `endRef` marks its end for the compact bar.
 */
export function RecurringHead({ subtitle, kicker, endRef }: { subtitle?: string; kicker?: string; endRef?: (node: HTMLElement | null) => void }) {
  const back = useHomeBack();
  return (
    <header className="ui-recurring-head">
      <BackButton fallback={back} text="בית" />
      {kicker != null ? <p className="ui-recurring-kicker t-meta">{kicker}</p> : null}
      <FocusTitle className="t-title">קבועים</FocusTitle>
      {subtitle != null ? <p className="ui-recurring-sub t-meta">{subtitle}</p> : null}
      {endRef != null ? <span ref={endRef} className="ui-compact-mark" aria-hidden="true" /> : null}
    </header>
  );
}

/**
 * No recurring charge yet: the title and the one line of what will show here (FLOW-447c, StatesRecurringEmpty).
 * FLOW-1014: the add row is the screen's one action, so the first recurring line can be added here too.
 */
export function RecurringListEmpty({ addLine }: { addLine?: ReactNode }) {
  return (
    <div className="ui-recurring">
      <div className="ui-recurring-body">
        <RecurringHead />
        <EmptyState icon={<RepeatIcon />} title="עוד Flow לומד" body="חיובים והכנסות שחוזרים כל חודש יופיעו כאן אחרי חודשיים של תנועות. אפשר גם לסמן שורה כקבועה מדף התנועה." action={addLine} />
      </div>
    </div>
  );
}

/** A late charge's card: its name and how late, the dashed ring in the signal colour. Hidden until it is late again. */
function lateCard(row: RecurringListRow, money: (minor: bigint) => string): BannerRow {
  const words = row.suggestion != null ? "אולי הגיע בשם אחר" : row.status;
  return {
    id: `late:${row.id}`,
    dismissKey: `late:${row.alertKey ?? row.id}`,
    to: row.href,
    icon: <StatusMark kind="late" />,
    title: <>{row.name} · {words} · <bdi dir="ltr">{money(row.minor)}</bdi></>,
    // FLOW-1097: under 360px the charge and its amount; how late is on its page.
    short: row.name,
    tag: money(row.minor),
  };
}

/** A group head's summary: "עוד $607 · שולם $76" (income: "עוד +$2,650 · התקבל $3,200"). */
function groupSummary(group: RecurringListGroup, money: (minor: bigint) => string): ReactNode {
  let left = 0n;
  let done = 0n;
  for (const row of group.rows) {
    if (row.paid) done += row.minor;
    else left += row.minor;
  }
  const plus = group.income ? "+" : "";
  const parts: ReactNode[] = [];
  if (left > 0n) parts.push(<span key="left">עוד <bdi dir="ltr">{`${plus}${money(left)}`}</bdi></span>);
  if (done > 0n) parts.push(<span key="done">{group.income ? "התקבל" : "שולם"} <bdi dir="ltr">{money(done)}</bdi></span>);
  if (parts.length === 0) return String(group.rows.length);
  return parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]));
}

/** The board's filter: every group, the expense groups, or the income groups. */
export type RecurringFilter = "all" | "out" | "in";

const FILTERS: { value: RecurringFilter; label: string }[] = [
  { value: "all", label: "הכול" },
  { value: "out", label: "הוצאות" },
  { value: "in", label: "הכנסות" },
];

/** "5 מתוך 11": the charges of a side still to come, out of all of them. */
function leftOf(groups: readonly RecurringListGroup[], income: boolean): string {
  const rows = groups.filter((group) => group.income === income).flatMap((group) => group.rows);
  return `${String(rows.filter((row) => !row.paid).length)} מתוך ${String(rows.length)}`;
}

/**
 * FLOW-447, FLOW-1048 (V3-Recurring, the List pattern): Back to בית, the title and the month line; two cards, what
 * is still to pay and still to come in; the late charges as "לא הגיעו" cards (hidden on this device until they are
 * late again); the הכול / הוצאות / הכנסות segment, which docks into the 56px bar; then the groups by category under
 * one-line sticky heads, 64px rows with a status mark each.
 */
export function RecurringList({ project, subtitle, currency, outflow, inflow, late, groups, offlineSince, addLine }: RecurringListProps) {
  const money = (minor: bigint) => formatAmountText(minor, currency);
  const back = useHomeBack();
  const [filter, setFilter] = useState<RecurringFilter>("all");
  const [headEnd, setHeadEnd] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(headEnd, true, DETAIL_BAR);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: DETAIL_BAR });
  const shown = groups.filter((group) => filter === "all" || group.income === (filter === "in"));
  const segment = (
    <SegmentedControl<RecurringFilter>
      label="סינון"
      showLabel={false}
      value={filter}
      options={FILTERS}
      onChange={(next) => {
        setFilter(next);
        scrollUnderBar();
      }}
    />
  );
  return (
    <div className="ui-recurring">
      <CompactBar title="קבועים" figure={`עוד לשלם ${money(outflow.toCome)}`} label="בית" backTo={back} size="detail" shown={barShown} dock={segment} docked={docked} />
      <div className="ui-recurring-body">
        <RecurringHead kicker={project} subtitle={subtitle} endRef={setHeadEnd} />
        {offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />}
        <section className="ui-recurring-sums" aria-label="החודש">
          <div className="ui-recurring-sum">
            <span className="ui-recurring-sum-label">עוד לשלם</span>
            <bdi dir="ltr" className="ui-recurring-sum-figure">{money(outflow.toCome)}</bdi>
            <span className="ui-recurring-sum-note">{leftOf(groups, false)} · שולם <bdi dir="ltr">{money(outflow.paid)}</bdi></span>
          </div>
          <div className="ui-recurring-sum">
            <span className="ui-recurring-sum-label">עוד לקבל</span>
            <bdi dir="ltr" className="ui-recurring-sum-figure ui-recurring-income">{`+${money(inflow.toCome)}`}</bdi>
            <span className="ui-recurring-sum-note">{leftOf(groups, true)} · התקבל <bdi dir="ltr">{money(inflow.got)}</bdi></span>
          </div>
        </section>
        <AttentionCards rows={late.map((row) => lateCard(row, money))} storageKey="recurring" title="לא הגיעו" />
        <div className="ui-recurring-filter">
          <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
          <DockSlot docked={docked}>{segment}</DockSlot>
        </div>
        {shown.map((group, index) => (
          <section key={group.id} className="ui-month ui-recurring-group" aria-labelledby={`recurring-group-${String(index)}`}>
            <GroupHead id={`recurring-group-${String(index)}`} title={group.title} summary={groupSummary(group, money)} />
            <List layout="flat">
              {group.rows.map((row) => (
                <ListRow
                  key={row.id}
                  layout="flat"
                  variant="project"
                  className={row.paid ? undefined : "ui-recurring-due"}
                  icon={<StatusMark kind={row.mark} />}
                  title={row.name}
                  hint={[row.status, row.place].filter((part) => part != null && part !== "").join(" · ")}
                  tone={row.mark === "late" ? "warning" : undefined}
                  agorot={row.minor}
                  currency={currency}
                  amountDirection={row.income ? "income" : undefined}
                  endSub={row.paid && row.hint != null ? <span className={row.alert === true ? "ui-recurring-alert" : undefined}>{row.hint}</span> : undefined}
                  href={row.href}
                />
              ))}
            </List>
          </section>
        ))}
        {addLine}
      </div>
    </div>
  );
}
