import { useState } from "react";
import type { LoanScheduleRow } from "@flow/shared";
import { BackButton } from "../ui/back";
import { CompactBar } from "../ui/compact-bar";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { GroupHead } from "../ui/group-head";
import { List, ListRow } from "../ui/list-row";
import { DETAIL_BAR, useScrolledPast } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { StatusMark } from "../ui/status-mark";
import type { LoanDetail, LoanPayment } from "./loan-detail-data";
import { dayMonth, loanPaymentYears, monthYear, paymentSplitText, paymentTotals, wholeMoney } from "./loan-detail-view-data";
import type { LoanCurrency } from "./loan-form";

/** שולמו (the attached payments) or הבאים (the schedule from today). */
export type LoanPaymentsTab = "paid" | "upcoming";

export type UpcomingYear = { year: string; count: number; totalMinor: bigint; rows: LoanScheduleRow[] };

/** FLOW-1046: the payments left on the schedule in calendar years, soonest first, each in date order. */
export function upcomingPaymentYears(rows: readonly LoanScheduleRow[]): UpcomingYear[] {
  const byYear = new Map<string, LoanScheduleRow[]>();
  for (const row of [...rows].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))) {
    const year = row.dueDate.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([year, list]) => ({ year, count: list.length, totalMinor: list.reduce((sum, row) => sum + row.paymentMinor, 0n), rows: list }));
}

/** A group head's summary: "10 · $52,400". */
function yearSummary(count: number, totalMinor: bigint, currency: LoanCurrency): string {
  return `${String(count)} · ${wholeMoney(totalMinor, currency)}`;
}

/** An upcoming payment's parts: "קרן $3,958 · ריבית $919 · נאמנות $363". */
function upcomingSplit(row: LoanScheduleRow, currency: LoanCurrency): string {
  const parts: string[] = [];
  if (row.principalMinor > 0n) parts.push(`קרן ${wholeMoney(row.principalMinor, currency)}`);
  if (row.interestMinor > 0n) parts.push(`ריבית ${wholeMoney(row.interestMinor, currency)}`);
  if (row.escrowMinor > 0n) parts.push(`נאמנות ${wholeMoney(row.escrowMinor, currency)}`);
  return parts.join(" · ");
}

/**
 * FLOW-139c, FLOW-1046 (V3-LoanPayments, the List pattern): `/loans/:id/payments`. Back to the loan, the title,
 * the summary line and the figure, then the שולמו / הבאים segment, which docks into the compact bar; the rows
 * sit in years under one-line sticky heads. A paid row opens its transaction; an upcoming one only reads.
 */
export function LoanPaymentsView({ loan, payments, upcoming, projectName, search, back, initialTab = "paid" }: {
  loan: LoanDetail;
  payments: readonly LoanPayment[];
  /** The schedule's rows from today; null for a loan with no schedule (on demand) or a closed one. */
  upcoming: readonly LoanScheduleRow[] | null;
  projectName: string | null;
  search: string;
  /** The loan's page. */
  back: string;
  /** The tab it opens on: "התשלום הבא" on the loan page opens הבאים. */
  initialTab?: LoanPaymentsTab;
}) {
  const [tab, setTab] = useState<LoanPaymentsTab>(upcoming == null ? "paid" : initialTab);
  const [titleMark, setTitleMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(titleMark, true, DETAIL_BAR);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: DETAIL_BAR });
  const totals = paymentTotals(payments);
  const paidYears = loanPaymentYears(payments);
  const nextYears = upcomingPaymentYears(upcoming ?? []);
  const nextCount = upcoming?.length ?? 0;
  const paid = tab === "paid";
  const figure = paid ? totals.total : loan.balanceMinor;
  const lastDue = upcoming?.[upcoming.length - 1]?.dueDate;
  const sub = paid
    ? [`${String(payments.length)} תשלומים מאז ${monthYear(loan.startDate)}`, projectName].filter((item) => item != null).join(" · ")
    : `${String(nextCount)} תשלומים${lastDue == null ? "" : ` עד ${monthYear(lastDue)}`} · נשאר לשלם`;
  const control = (
    <SegmentedControl<LoanPaymentsTab>
      label="תשלומים"
      showLabel={false}
      value={tab}
      options={[
        { value: "paid", label: `שולמו · ${String(payments.length)}` },
        { value: "upcoming", label: `הבאים · ${String(nextCount)}` },
      ]}
      onChange={(next) => {
        setTab(next);
        scrollUnderBar();
      }}
    />
  );
  return (
    <div className="ui-loan-payments">
      <CompactBar
        title={`תשלומים · ${loan.name}`}
        figure={wholeMoney(figure, loan.currency)}
        label={loan.name}
        backTo={back}
        size="detail"
        shown={barShown}
        dock={upcoming == null ? undefined : control}
        docked={docked}
      />
      <header className="ui-loan-payments-head">
        <BackButton fallback={back} text={loan.name} />
        <h1 className="ui-loan-payments-title t-title">תשלומים</h1>
        <p className="ui-loan-payments-sub t-meta">{sub}</p>
        <p className="ui-loan-payments-total t-detail"><bdi dir="ltr">{wholeMoney(figure, loan.currency)}</bdi></p>
        <span ref={setTitleMark} className="ui-compact-mark" aria-hidden="true" />
      </header>
      {upcoming == null ? null : (
        <div className="ui-loan-payments-filter">
          <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
          <DockSlot docked={docked}>{control}</DockSlot>
        </div>
      )}
      {paid && payments.length === 0 ? <p className="ui-page-pad t-caption t-muted">אין עדיין תשלומים משויכים.</p> : null}
      {paid
        ? paidYears.map((year) => (
          <section key={year.year} className="ui-month ui-loan-year" aria-labelledby={`loan-paid-${year.year}`}>
            <GroupHead id={`loan-paid-${year.year}`} title={year.year} summary={yearSummary(year.count, year.totalMinor, loan.currency)} />
            <List layout="flat">
              {year.rows.map((row) => (
                <ListRow
                  key={row.transactionId}
                  variant="project"
                  layout="flat"
                  href={`/transactions/${row.transactionId}${search}`}
                  icon={<StatusMark kind="paid" />}
                  title={row.date}
                  hint={row.needsReview ? "ממתין לבדיקה" : paymentSplitText(row, loan.currency)}
                  tone={row.needsReview ? "warning" : undefined}
                  agorot={row.totalMinor}
                  currency={loan.currency}
                />
              ))}
            </List>
          </section>
        ))
        : nextYears.map((year) => (
          <section key={year.year} className="ui-month ui-loan-year" aria-labelledby={`loan-next-${year.year}`}>
            <GroupHead id={`loan-next-${year.year}`} title={year.year} summary={yearSummary(year.count, year.totalMinor, loan.currency)} />
            <List layout="flat">
              {year.rows.map((row) => (
                <ListRow
                  key={row.dueDate}
                  variant="project"
                  layout="flat"
                  icon={<StatusMark kind="due" />}
                  title={dayMonth(row.dueDate)}
                  hint={`צפוי · ${upcomingSplit(row, loan.currency)}`}
                  agorot={row.paymentMinor}
                  currency={loan.currency}
                />
              ))}
            </List>
          </section>
        ))}
    </div>
  );
}
