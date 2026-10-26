import type { LoanSplitPart } from "@flow/shared";
import { useState, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { Card } from "../ui/card";
import { formatDisplay } from "../ui/date-math";
import { CheckIcon, ChevronIcon } from "../ui/icons";
import { LOAN_CLOSED_NOTE, loanClosedLine, type LoanCloseReason } from "./loan-copy";
import { PartsBar } from "../ui/parts-bar";
import { SegmentedControl } from "../ui/segmented-control";
import type { LoanCategory, LoanDetail, LoanPayment, LoanRateRow } from "./loan-detail-data";
import { formatRatePpm, rateInForce } from "./loan-detail-data";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";
import type { LoanOutlook } from "./loan-outlook";
import { loanPaidCard, PAID_PARTS, paidMoney, type PaidPeriod } from "./loans-paid";
import {
  balanceProgress,
  balanceProgressText,
  dayMonth,
  LOAN_PART_BOARD_LABEL,
  LOAN_PART_SHORT_LABEL,
  loanMoney,
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

/** FLOW-962 (board Loan closed early): how a closed loan ended, and that it left the forecast and the debt. */
export function LoanClosedCard({ status, closedOn }: { status: LoanCloseReason; closedOn: string | null }) {
  return (
    <Card as="section" className="ui-loan-card ui-loan-closed" aria-label="ההלוואה נסגרה">
      <p className="ui-loan-closed-line">
        <CheckIcon size={20} />
        {loanClosedLine(status, closedOn)}
      </p>
      <p className="ui-loan-card-text">{LOAN_CLOSED_NOTE[status]}</p>
    </Card>
  );
}

/** The next payment, one line: its date and figure, and its parts in a row ("קרן $1,066 · ריבית $1,087 · נאמנות $363"). */
export function LoanNextCard({ loan, outlook }: { loan: LoanDetail; outlook: LoanOutlook }) {
  const next = outlook.next;
  const parts = [
    { key: "principal", value: next.principalMinor },
    { key: "interest", value: next.interestMinor },
    { key: "escrow", value: next.escrowMinor },
  ] as const;
  const line = parts
    .filter((part) => part.value > 0n)
    .map((part) => `${LOAN_PART_SHORT_LABEL[part.key]} ${loanMoney(loan, part.value)}`)
    .join(" · ");
  return (
    <Card as="section" className="ui-loan-card ui-loan-next-card" aria-label="התשלום הבא">
      <div className="ui-loan-card-head">
        <h2 className="ui-loan-next-title">התשלום הבא · {dayMonth(next.dueDate)}</h2>
        <bdi className="ui-loan-next-amount" dir="ltr">{loanMoney(loan, next.paymentMinor)}</bdi>
      </div>
      <p className="ui-loan-card-note">{line}</p>
    </Card>
  );
}

/** The line under each part of the שולם card: what the part does, and whether it counts in the profit. */
function paidPartNote(loan: LoanDetail, categories: readonly LoanCategory[], part: LoanSplitPart): string {
  const profit = partInProfit(loan, categories, part) ? "נספרת ברווח" : "לא נספרת ברווח";
  if (part === "principal") return `מקטינה את החוב · ${profit}`;
  if (part === "escrow") return `מסים וביטוח · ${profit}`;
  return profit;
}

/**
 * שולם: what the loan's attached payments paid, since the loan started or this year (the period
 * switch), part by part, with what each part does. An owner taps a part to set its category, as
 * the parts rows did before (the part sheet). The principal since the start is the original less
 * the balance (loanPaidParts).
 */
export function LoanPaidCard({ loan, payments, categories, today, onOpenPart }: {
  loan: LoanDetail;
  payments: readonly LoanPayment[];
  categories: readonly LoanCategory[];
  today: string;
  onOpenPart: ((part: LoanSplitPart) => void) | null;
}) {
  const [period, setPeriod] = useState<PaidPeriod>("all");
  const card = loanPaidCard(loan, payments, period, today);
  // Nothing attached and nothing paid off: no card.
  if (payments.length === 0 && card.totalMinor === 0n) return null;
  const shown = PAID_PARTS.filter(({ part }) => card.totals[part] > 0n);
  return (
    <Card as="section" className="ui-loan-card ui-loan-paid" aria-label="שולם">
      <div className="ui-loan-paid-head">
        <p className="ui-loan-card-label">{card.label}</p>
        <SegmentedControl<PaidPeriod>
          label="תקופה"
          showLabel={false}
          value={period}
          onChange={setPeriod}
          options={[{ value: "all", label: "מההתחלה" }, { value: "year", label: today.slice(0, 4), numeric: true }]}
        />
      </div>
      <bdi className="ui-loan-paid-total" dir="ltr">{paidMoney(card.totalMinor, loan.currency)}</bdi>
      {shown.length === 0 ? null : (
        <PartsBar parts={shown.map(({ part, tone }) => ({ key: part, value: card.totals[part], tone }))} height={8} gap={2} radius="block" label={card.label} />
      )}
      {shown.length === 0 ? null : (
        <ul className="ui-loan-paid-parts">
          {shown.map(({ part, tone }) => {
            const body = (
              <>
                <span className="ui-parts-dot" data-tone={tone} aria-hidden="true" />
                <span className="ui-loan-paid-text">
                  <span className="ui-loan-paid-name">{LOAN_PART_BOARD_LABEL[part]}</span>{" "}
                  <span className="ui-loan-paid-note">{paidPartNote(loan, categories, part)}</span>
                </span>
                <bdi className="ui-loan-paid-amount" dir="ltr">{paidMoney(card.totals[part], loan.currency)}</bdi>
              </>
            );
            return (
              <li key={part}>
                {onOpenPart == null ? (
                  <div className="ui-loan-paid-part">{body}</div>
                ) : (
                  <button type="button" className="ui-loan-paid-part" onClick={() => { onOpenPart(part); }}>{body}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="ui-loan-card-note ui-loan-paid-foot">{card.note}</p>
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
        // FLOW-962 (board Loan new): what will appear here, and the way to the bank.
        <div className="ui-loan-card-pad ui-loan-recent-empty">
          <p className="ui-loan-card-text">עוד אין תשלומים. כשתשלום מהבנק ישויך ל־{loan.name}, הוא יופיע כאן והחוב יתעדכן.</p>
          <Link className="ui-loan-recent-bank" to={`/settings/connections${search}`}>איך מחברים את חשבון הבנק</Link>
        </div>
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
