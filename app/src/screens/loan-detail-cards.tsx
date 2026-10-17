import type { LoanSplitPart } from "@flow/shared";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { Card } from "../ui/card";
import { formatDisplay } from "../ui/date-math";
import { ChevronIcon } from "../ui/icons";
import { PartsBar, type BarLegendItem, type BarPart } from "../ui/parts-bar";
import type { LoanCategory, LoanDetail, LoanPayment, LoanRateRow } from "./loan-detail-data";
import { formatRatePpm, loanParts, rateInForce } from "./loan-detail-data";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";
import { periodTotal, roundTotals, type LoanOutlook, type OutlookPeriod } from "./loan-outlook";
import {
  balanceProgress,
  balanceProgressText,
  dayMonth,
  LOAN_PART_BOARD_LABEL,
  loanMoney,
  loanShowsCents,
  partCategory,
  partInProfit,
  paymentRow,
  paymentSplitText,
  wholeMoney,
  type PaymentRow,
} from "./loan-detail-view-data";

/**
 * FLOW-139c: the loan page's cards (board: Loan amortizing, Loan interest only). Each card is
 * presentational; its props come from the loan page, which keeps the saves and the sheets.
 */

/** The balance card: the figure, the progress of the principal, and what the line under it says. */
export function LoanBalanceCard({ loan, outlook }: { loan: LoanDetail; outlook: LoanOutlook | null }) {
  const { paidMinor } = balanceProgress(loan);
  return (
    <Card className="ui-loan-card ui-loan-balance">
      <p className="ui-loan-card-label">{loan.kind === "demand" ? "יתרת קרן" : "יתרה היום"}</p>
      <span className="ui-loan-balance-figure">{wholeMoney(loan.balanceMinor, loan.currency)}</span>
      {outlook == null ? null : (
        <>
          <PartsBar
            parts={[{ key: "paid", value: paidMinor, tone: "accent" }]}
            total={loan.principalMinor}
            height={8}
            gap={2}
            radius="block"
            label="נפרע מהקרן"
          />
          <p className="ui-loan-card-text">{balanceProgressText(loan, outlook)}</p>
        </>
      )}
    </Card>
  );
}

/** The next payment: its figure and its parts, with the legend, and one line on what the parts do. */
export function LoanNextCard({ loan, outlook }: { loan: LoanDetail; outlook: LoanOutlook }) {
  const next = outlook.next;
  const money = (minor: bigint) => <bdi dir="ltr">{loanMoney(loan, minor)}</bdi>;
  const parts = [
    { key: "principal", value: next.principalMinor, tone: "accent" },
    { key: "interest", value: next.interestMinor, tone: "accent-dim" },
    { key: "escrow", value: next.escrowMinor, tone: "muted" },
  ] as const;
  const shown = parts.filter((part) => part.value > 0n);
  const bars: BarPart[] = shown.map((part) => ({ key: part.key, value: part.value, tone: part.tone }));
  const legend: BarLegendItem[] = shown.map((part) => ({
    key: part.key,
    label: LOAN_PART_BOARD_LABEL[part.key],
    value: money(part.value),
  }));
  const interestOnly = next.principalMinor === 0n;
  return (
    <Card className="ui-loan-card ui-loan-next-card">
      <div className="ui-loan-card-head">
        <h2 className="ui-loan-card-title">התשלום הבא · {dayMonth(next.dueDate)}</h2>
        <span className="ui-loan-card-total">{money(next.paymentMinor)}</span>
      </div>
      <PartsBar parts={bars} height={8} gap={2} radius="block" legend={legend} label="התשלום הבא לפי חלקים" />
      <p className="ui-loan-card-note">
        {interestOnly ? "רק ריבית בכל חודש. הקרן לא קטנה עד הסוף." : "הקרן מקטינה את החוב ולא נספרת ברווח. הריבית והנאמנות נספרות."}
      </p>
    </Card>
  );
}

export type LoanTermRow = {
  key: string;
  label: string;
  value: ReactNode;
  /** Null for a viewer's row: static, no chevron. */
  onOpen: (() => void) | null;
  buttonRef?: Ref<HTMLButtonElement>;
};

/** A card of rows, each a label over its value; a row with `onOpen` is a button with a chevron. */
export function LoanRowsCard({ rows, className, head }: { rows: LoanTermRow[]; className: string; head?: ReactNode }) {
  return (
    <Card className={`ui-loan-card ui-loan-rows ${className}`}>
      {head}
      {rows.map((row) => row.onOpen == null ? (
        <div key={row.key} className="ui-loan-term ui-loan-term-static">
          <span className="ui-loan-term-label">{row.label}</span>
          <span className="ui-loan-term-value">{row.value}</span>
        </div>
      ) : (
        <button key={row.key} type="button" ref={row.buttonRef} className="ui-loan-term" onClick={row.onOpen}>
          <span className="ui-loan-term-text">
            <span className="ui-loan-term-label">{row.label}</span>{" "}
            <span className="ui-loan-term-value">{row.value}</span>
          </span>
          <span className="ui-loan-term-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
        </button>
      ))}
    </Card>
  );
}

/** "11.25% · מ־01/09/2026", or "6% · מההתחלה": the rate in force and the day it took effect. */
export function RateValue({ loan, today }: { loan: Pick<LoanDetail, "annualRatePpm" | "rates">; today: string }) {
  const { ppm, from } = rateInForce(loan, today);
  return (
    <>
      <bdi className="ui-num" dir="ltr">{formatRatePpm(ppm)}</bdi>
      {from == null ? " · מההתחלה" : <> · מ־<bdi className="ui-num" dir="ltr">{formatDisplay(from)}</bdi></>}
    </>
  );
}

/** The rate changes past the start (only when there are some): one button row each. */
export function LoanRateChangesCard({ rates, onOpen }: { rates: readonly LoanRateRow[]; onOpen: ((rate: LoanRateRow) => void) | null }) {
  return (
    <LoanRowsCard
      className="ui-loan-rate-changes"
      head={<h2 className="ui-loan-card-title ui-loan-card-pad">שינויי ריבית</h2>}
      rows={rates.map((rate) => ({
        key: rate.id,
        label: `מ־${formatDisplay(rate.effectiveDate)}`,
        value: <bdi className="ui-num" dir="ltr">{formatRatePpm(rate.annualRatePpm)}</bdi>,
        onOpen: onOpen == null ? null : () => { onOpen(rate); },
      }))}
    />
  );
}

/**
 * שולם השנה: one row per part paid this year (a part at $0 is left out), with its category and
 * whether it counts in the profit. Nothing paid this year: no card.
 */
export function LoanYtdCard({ loan, paid, categories, onOpenPart }: {
  loan: LoanDetail;
  paid: OutlookPeriod;
  categories: readonly LoanCategory[];
  onOpenPart: ((part: LoanSplitPart) => void) | null;
}) {
  if (paid.payments === 0) return null;
  const rounded = roundTotals(paid.totals);
  const exactTotal = (totals: OutlookPeriod["totals"]) => totals.interest + totals.escrow + totals.principal + totals.fees;
  const rows = loanParts(loan).filter((part) => rounded[part] > 0n);
  return (
    <Card className="ui-loan-card ui-loan-ytd">
      <div className="ui-loan-card-head ui-loan-card-pad">
        <h2 className="ui-loan-card-title">שולם השנה</h2>
        <span className="ui-loan-card-meta"><bdi dir="ltr">{loanMoney(loan, loanShowsCents(loan) ? exactTotal(paid.totals) : periodTotal(paid.totals))}</bdi></span>
      </div>
      {rows.map((part) => {
        const name = partCategory(loan, categories, part)?.name ?? null;
        const profit = partInProfit(loan, categories, part) ? "נספר ברווח" : "לא נספר ברווח";
        const note = [name, profit].filter((item) => item != null).join(" · ");
        const body = (
          <>
            <span className="ui-loan-row-text">
              <span className="ui-loan-row-title">{LOAN_PART_BOARD_LABEL[part]}</span>{" "}
              <span className="ui-loan-row-note">{note}</span>
            </span>
            <bdi className="ui-loan-row-amount" dir="ltr">{loanMoney(loan, loanShowsCents(loan) ? paid.totals[part] : rounded[part])}</bdi>
          </>
        );
        return onOpenPart == null ? (
          <div key={part} className="ui-loan-row ui-loan-ytd-row">{body}</div>
        ) : (
          <button key={part} type="button" className="ui-loan-row ui-loan-ytd-row" onClick={() => { onOpenPart(part); }}>{body}</button>
        );
      })}
    </Card>
  );
}

/** One payment as a row that opens its transaction: date (with the year when it is not this year), split, amount. */
export function PaymentRowLink({ row, currency, search, year, withSplit = true }: {
  row: PaymentRow;
  currency: LoanCurrency;
  search: string;
  /** The page's year: a date in another year shows its year too. */
  year: string;
  /** The split under the date: the all-payments page has it, the loan page's last payments do not (the board's). */
  withSplit?: boolean;
}) {
  const showYear = row.dateIso.slice(0, 4) !== year;
  const date = showYear ? `${row.date}/${row.dateIso.slice(0, 4)}` : row.date;
  return (
    <Link className={`ui-loan-row${row.needsReview ? " ui-loan-row-review" : ""}`} to={`/transactions/${row.transactionId}${search}`}>
      <span className="ui-loan-row-text">
        <bdi className="ui-loan-row-title" dir="ltr">{date}</bdi>
        {row.needsReview || withSplit ? (
          <span className="ui-loan-row-note">{row.needsReview ? "ממתין לבדיקה" : paymentSplitText(row, currency)}</span>
        ) : null}
      </span>
      <bdi className="ui-loan-row-amount" dir="ltr">{formatLoanMoney(row.totalMinor, currency)}</bdi>
      <span className="ui-loan-term-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
    </Link>
  );
}

/** The last three payments, and the link to all of them. */
export function LoanRecentCard({ loan, payments, search, loanPath, year }: {
  loan: LoanDetail;
  payments: readonly LoanPayment[];
  search: string;
  loanPath: string;
  year: string;
}) {
  const rows = payments.slice(0, 3);
  return (
    <Card className="ui-loan-card ui-loan-recent">
      <h2 className="ui-loan-card-title ui-loan-card-pad">{payments.length >= 3 ? "3 התשלומים האחרונים" : "התשלומים"}</h2>
      {payments.length === 0 ? (
        <p className="ui-loan-card-note ui-loan-card-pad">אין עדיין תשלומים משויכים.</p>
      ) : (
        <>
          {rows.map((payment) => (
            <PaymentRowLink
              key={payment.transactionId}
              row={paymentRow(payment)}
              currency={loan.currency}
              search={search}
              year={year}
              withSplit={false}
            />
          ))}
          <Link className="ui-loan-all" to={`${loanPath}/payments${search}`}>כל התשלומים</Link>
        </>
      )}
    </Card>
  );
}
