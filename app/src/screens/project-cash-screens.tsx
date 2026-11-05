import { formatAmountText, type CashLine, type CashMonths, type ProjectDetail } from "@flow/shared";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cashMonthKey, cashTitle, shownCashRows } from "../cash";
import { projectCashSummaryRows } from "../project-cash";
import { projectLineGroups, type ProjectLinesFilter } from "../project-list";
import { chargeHref } from "../recurring-charge";
import type { ScheduleRow } from "../recurring-schedule";
import { BackButton } from "../ui/back";
import { Amount } from "../ui/amount";
import { AttentionCards } from "../ui/attention-cards";
import { BandOfflineLine } from "../ui/band-states";
import type { BannerRow } from "../ui/banner";
import { CompactBar } from "../ui/compact-bar";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { FocusTitle } from "../ui/focus-title";
import { GroupHead } from "../ui/group-head";
import { FailureLine } from "../ui/empty-state";
import { DocumentIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { DETAIL_BAR, useScrolledPast } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { ListSkeleton, Skeleton } from "../ui/skeleton";
import { StatusMark } from "../ui/status-mark";
import { TopBand, usePageAtEnd } from "../ui/top-band";
import { israelToday } from "../ui/date-math";
import { reportsTo } from "../reports";
import { loansFigure } from "./project-overview";
import { ProjectEmptyCard, ProjectLinks, type ProjectLink } from "./project-page-cards";
import type { ProjectInvestment } from "./project-investment-data";

type Project = NonNullable<ProjectDetail>;

const FILTERS: { value: ProjectLinesFilter; label: string; short?: string }[] = [
  { value: "all", label: "הכול" },
  { value: "fixed", label: "קבועים" },
  { value: "left", label: "נותר לשלם", short: "נותר" },
];

/** השקעה והלוואות: הון עצמי בנכס when known, else the loans; null with neither (the row hides). */
export function investmentLoansRow(data: ProjectInvestment, project: Project): { hint?: string; figure?: string } | null {
  const figures = data.isOverhead ? null : data.figures;
  if (figures?.currentEquityMinor != null) {
    return { hint: "הון עצמי בנכס", figure: formatAmountText(figures.currentEquityMinor, figures.currency) };
  }
  const loans = loansFigure(project);
  if (loans != null) return { hint: loans };
  const entered = figures != null
    && (figures.purchaseMinor != null || figures.valueMinor != null || figures.arvMinor != null || figures.rehabMinor !== 0n);
  return entered ? {} : null;
}

/**
 * FLOW-163 (board ReportEntryProject): דוחות on the band, before ⋯. It opens the reports already on
 * this project: the P&L by project (FLOW-1045 sends the old link to /reports/pnl?view=project).
 */
export function ProjectReportsLink({ projectId, search }: { projectId: string; search: string }) {
  return (
    <Link className="ui-band-reports m-press" to={reportsTo("pnl", { kind: "project", id: projectId }, search)}>
      <DocumentIcon size={20} />
      <span>דוחות</span>
    </Link>
  );
}

function magnitude(minor: number | bigint): bigint {
  const value = BigInt(minor);
  return value < 0n ? -value : value;
}

/** A recurring charge of the project this month: its mark, its day or arrival in words, and its amount. */
function ChargeRow({ row, search }: { row: ScheduleRow; search: string }) {
  const arrived = row.state === "arrived";
  const late = row.state === "late";
  const minor = magnitude(arrived && row.amount_minor != null ? row.amount_minor : row.typical_amount_minor);
  const day = String(row.typical_day);
  const hint = arrived
    ? row.direction === "income" ? "התקבל החודש" : "שולם החודש"
    : late ? `איחר · צפוי ב-${day}` : `צפוי ב-${day}`;
  return (
    <ListRow
      variant="project"
      title={row.party_name}
      hint={row.category_name == null ? hint : `${hint} · ${row.category_name}`}
      icon={<StatusMark kind={arrived ? "paid" : late ? "late" : "due"} />}
      agorot={minor}
      currency={row.currency}
      amountDirection={row.direction === "income" ? "income" : undefined}
      href={chargeHref(row.direction, row.party_id, search, row.project_id)}
    />
  );
}

/** A month line that belongs to no recurring charge: a dot, its date and category, and its amount. */
function OnceRow({ line, search }: { line: CashLine; search: string }) {
  const date = `${line.doc_date.slice(8, 10)}/${line.doc_date.slice(5, 7)}`;
  return (
    <ListRow
      variant="project"
      title={line.supplier_name ?? line.description}
      hint={line.category_name == null ? date : `${date} · ${line.category_name}`}
      icon={<StatusMark kind="once" />}
      agorot={magnitude(line.amount_minor)}
      currency={line.currency}
      amountDirection={line.side === "in" ? "income" : undefined}
      href={`/transactions/${line.transaction_id}${search}`}
    />
  );
}

/** A group's line at the head's end: the count, and the total in its first row's currency. */
function summaryOf(count: number, currency: string | undefined, total: bigint): ReactNode {
  return (
    <>
      <bdi dir="ltr">{String(count)}</bdi>
      {currency == null ? null : <> · <bdi dir="ltr">{formatAmountText(total, currency)}</bdi></>}
    </>
  );
}

/**
 * FLOW-419 (owner's option A "Like Home", decision 0176). The project page is the project's cash, as Home is
 * the company's. FLOW-1044 (board V3-Project): the band stays as it is (the owner: keep the look); under it the
 * Overview pattern: דורש טיפול as row-cards, the kind's card (the budget, the returns or the contract), the
 * links to the investment, the profit since the start and next month, then the month's lines in groups
 * under a segment that docks into the bar.
 */
export function ProjectCashOverview({
  project,
  data,
  search,
  stateLine,
  menu,
  attention = [],
  kindCard,
  links = [],
  fresh = false,
  schedule = [],
  lines = [],
  linesRetry,
  offlineSince = null,
  example,
  now,
}: {
  project: Project;
  /** Null while the cash read is still out: the band paints the project's name from its own read. */
  data: NonNullable<CashMonths> | null;
  search: string;
  /** The line under the name for a state other than active ("הסתיים"). */
  stateLine: string | null;
  menu: ReactNode;
  /** Home's attention rows for this project, with what each counts, for the row-cards. */
  attention?: BannerRow[];
  /** FLOW-1044: the kind's card: the budget (renovation), the returns (rental) or the contract (client). */
  kindCard?: ReactNode;
  /** FLOW-1044: the rows under the card. */
  links?: readonly ProjectLink[];
  /** A project with no line, invoice or month yet: the links give way to the empty card. */
  fresh?: boolean;
  /** The company's recurring schedule; the page keeps the project's own rows. */
  schedule?: readonly ScheduleRow[];
  /** The month's lines of the project, for the one-off group. */
  lines?: readonly CashLine[];
  /** A failed read of the charges or the lines: its retry line sits above the groups, which then say nothing. */
  linesRetry?: () => void;
  /** FLOW-961: offline, the moment the figures on screen are from; null online. */
  offlineSince?: number | null;
  example?: ReactNode;
  /** Stories and tests pin the month names. */
  now?: Date;
}) {
  const month = data?.months[0];
  const key = month == null ? null : cashMonthKey(month.month);
  const rows = data == null ? [] : shownCashRows(month, data.base_currency);
  // FLOW-445: once the figure scrolls under the band, the compact bar slides down: Back, "−$X • name", ⋯.
  const [titleEnd, setTitleEnd] = useState<HTMLSpanElement | null>(null);
  // A page too short to scroll the mark under the bar shows it at its bottom. A taller page passes the
  // mark before its bottom, so the mark alone decides there.
  const markPast = useScrolledPast(titleEnd, true, DETAIL_BAR);
  const atEnd = usePageAtEnd();
  const past = markPast || atEnd;
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown: past, bar: DETAIL_BAR });
  const [filter, setFilter] = useState<ProjectLinesFilter>("all");
  const first = rows[0];
  // FLOW-445: נכנס and יצא sit in the band on one line.
  const summaryRows = key == null ? [] : projectCashSummaryRows(project.id, key, rows, search, now);
  const bandRows = summaryRows.filter((row) => row.id === "in" || row.id === "out");
  const groups = projectLineGroups(schedule, lines, project.id, filter);
  const control = (
    <SegmentedControl
      label="סינון תנועות החודש"
      showLabel={false}
      value={filter}
      options={FILTERS}
      onChange={(next) => {
        setFilter(next);
        scrollUnderBar();
      }}
    />
  );
  const chargeTotal = (charges: readonly ScheduleRow[]) => charges
    .filter((row) => row.currency === charges[0]?.currency)
    .reduce((sum, row) => sum + magnitude(row.state === "arrived" && row.amount_minor != null ? row.amount_minor : row.typical_amount_minor), 0n);
  const lineTotal = (once: readonly CashLine[]) => once
    .filter((line) => line.currency === once[0]?.currency)
    .reduce((sum, line) => sum + magnitude(line.amount_minor), 0n);
  const hasLines = groups.left.length > 0 || groups.paid.length > 0 || (groups.once?.length ?? 0) > 0;
  return (
    <div className="ui-project-cash ui-project-page flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        example={example}
        leading={<BackButton fallback={`/projects${search}`} text="פרויקטים" onBand />}
        trailing={(
          <div className="ui-project-band-end">
            <ProjectReportsLink projectId={project.id} search={search} />
            {menu}
          </div>
        )}
        heroClassName="ui-band-hero-project"
        hero={
          <>
            <FocusTitle className="t-title">{project.name}</FocusTitle>
            {stateLine == null ? null : <p className="t-line2">{stateLine}</p>}
            {offlineSince == null ? null : <BandOfflineLine since={offlineSince} />}
            <p className="ui-band-label t-line2">{key == null ? "תזרים" : `${cashTitle(key, now)}${key === israelToday(now).slice(0, 7) ? " · עד היום" : ""}`}</p>
            {data == null ? (
              <Skeleton tone="band" className="ui-skel-project-num" />
            ) : (
              <div className="ui-project-profits t-detail">
                {rows.map((row, index) => (
                  <p key={row.currency}>
                    {/* As on Home: the band's figure is whole, short from 100K, and steps down until it fits. */}
                    <Amount agorot={row.net_minor} currency={row.currency} loss={row.net_minor < 0n} direction={row.net_minor > 0n ? "income" : undefined} size={index > 0 ? "display" : "hero"} compact />
                  </p>
                ))}
              </div>
            )}
            {bandRows.length === 0 ? null : (
              <div className="ui-project-band-pair">
                {bandRows.map((row) => (
                  <Link key={row.id} to={row.href ?? "#"} className="ui-band-row-link m-press" aria-label={row.name}>
                    <span className="ui-band-row-label">{row.id === "in" ? "נכנס" : "יצא"}</span>
                    <span className="ui-band-row-amount">
                      {row.amounts.map((amount) => (
                        <Amount key={amount.currency} agorot={amount.minor} currency={amount.currency} size="list" />
                      ))}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <span ref={setTitleEnd} className="ui-compact-mark" aria-hidden="true" />
          </>
        }
      />
      <CompactBar
        title={project.name}
        figureFirst
        figure={first == null ? undefined : <Amount agorot={first.net_minor} currency={first.currency} loss={first.net_minor < 0n} presentation="detail" />}
        backTo={`/projects${search}`}
        size="detail"
        shown={past}
        actions={menu}
        dock={control}
        docked={docked}
      />
      {data == null ? <ListSkeleton /> : null}
      <div className="ui-project-stack">
        <AttentionCards rows={attention} storageKey={`project:${project.id}`} />
        {kindCard}
        {fresh ? <ProjectEmptyCard /> : <ProjectLinks links={links} />}
      </div>
      {fresh ? null : (
        <div className="ui-project-lines">
          <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
          <div className="ui-page-pad ui-project-lines-filter">
            <DockSlot docked={docked}>{control}</DockSlot>
          </div>
          {linesRetry == null ? null : <FailureLine offline={!navigator.onLine} onRetry={linesRetry} />}
          {hasLines || linesRetry != null ? null : <p className="ui-page-pad ui-project-lines-none t-line2">{filter === "left" ? "אין מה לשלם עוד החודש." : "אין עדיין תנועות החודש."}</p>}
          {groups.left.length === 0 ? null : (
            <section className="ui-month" aria-labelledby={`project-left-${project.id}`}>
              <GroupHead id={`project-left-${project.id}`} title="נותר לשלם" summary={summaryOf(groups.left.length, groups.left[0]?.currency, chargeTotal(groups.left))} />
              <List>{groups.left.map((row) => <ChargeRow key={`${row.direction}:${row.party_id}`} row={row} search={search} />)}</List>
            </section>
          )}
          {groups.paid.length === 0 ? null : (
            <section className="ui-month" aria-labelledby={`project-paid-${project.id}`}>
              <GroupHead id={`project-paid-${project.id}`} title="קבועים ששולמו" summary={summaryOf(groups.paid.length, groups.paid[0]?.currency, chargeTotal(groups.paid))} />
              <List>{groups.paid.map((row) => <ChargeRow key={`${row.direction}:${row.party_id}`} row={row} search={search} />)}</List>
            </section>
          )}
          {groups.once == null || groups.once.length === 0 ? null : (
            <section className="ui-month" aria-labelledby={`project-once-${project.id}`}>
              <GroupHead id={`project-once-${project.id}`} title="חד-פעמי" summary={summaryOf(groups.once.length, groups.once[0]?.currency, lineTotal(groups.once))} />
              <List>{groups.once.map((line) => <OnceRow key={`${line.transaction_id}:${line.part ?? ""}`} line={line} search={search} />)}</List>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
