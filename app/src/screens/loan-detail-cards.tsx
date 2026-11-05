import type { LoanSplitPart } from "@flow/shared";
import { useState, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { Amount } from "../ui/amount";
import { hideRow, isRowHidden, readHidden, restoreAll } from "../ui/attention-dismiss";
import { BackButton, useGoBack } from "../ui/back";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { CompactBar } from "../ui/compact-bar";
import { formatDisplay } from "../ui/date-math";
import { FocusTitle } from "../ui/focus-title";
import { IconButton } from "../ui/icon-button";
import { BackIcon, CheckIcon, ChevronIcon, MoreIcon } from "../ui/icons";
import { useScrolledPast } from "../ui/screen-header";
import { TopBand } from "../ui/top-band";
import { LOAN_CLOSED_NOTE, loanClosedLine, type LoanCloseReason } from "./loan-copy";
import { PartsBar } from "../ui/parts-bar";
import { SegmentedControl } from "../ui/segmented-control";
import type { LoanCategory, LoanDetail, LoanPayment, LoanRateRow } from "./loan-detail-data";
import { formatRatePpm, rateInForce } from "./loan-detail-data";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";
import type { LoanOutlook } from "./loan-outlook";
import { loanPaidCard, loanPaidParts, PAID_PARTS, type PaidPeriod } from "./loans-paid";
import {
  balanceProgress,
  balanceProgressText,
  dayMonth,
  LOAN_PART_BOARD_LABEL,
  LOAN_PART_SHORT_LABEL,
  loanMoney,
  loanSubtitle,
  partInProfit,
  paymentRow,
  paymentSplitText,
  wholeMoney,
  type PaymentRow,
} from "./loan-detail-view-data";

/** FLOW-1046: the band bar's height (6 + 52 + 6). */
const BAND_BAR = 64;

/**
 * FLOW-139c: the loan page's cards (board: Loan amortizing, Loan interest only). Each card is
 * presentational; its props come from the loan page, which keeps the saves and the sheets.
 */

export type LoanBandRow = { key: string; label: string; value: string };

/**
 * FLOW-1046 (V3-Loan): the band's two rows under the balance, by kind. A regular loan: its monthly payment and
 * rate. Interest only: the monthly interest and the rate. On demand: the rate and what was repaid this year.
 * A loan with no schedule left (closed) keeps the rate alone.
 */
export function loanBandRows(loan: LoanDetail, outlook: LoanOutlook | null, payments: readonly LoanPayment[], today: string): LoanBandRow[] {
  const rate: LoanBandRow = { key: "rate", label: "ריבית", value: formatRatePpm(rateInForce(loan, today).ppm) };
  if (loan.kind === "demand") {
    const repaid = loanPaidParts(loan, payments, "year", today.slice(0, 4)).totals.principal;
    return [rate, { key: "repaid", label: "הוחזר השנה", value: wholeMoney(repaid, loan.currency) }];
  }
  if (outlook == null) return [rate];
  const payment = { key: "payment", label: loan.kind === "interest_only" ? "ריבית חודשית" : "תשלום חודשי", value: loanMoney(loan, outlook.next.paymentMinor) };
  return [payment, rate];
}

/**
 * FLOW-1046 (V3-Loan, the Overview pattern): the loan's violet band. Back, the name and its line, the balance
 * with the principal's progress, the kind's two rows and (FLOW-1055, as the board draws it) the next payment's
 * card; ⋯ opens the close sheet. Once the band has scrolled under the top, the band bar slides in with the name
 * and the balance.
 */
export function LoanBand({ loan, projectName, outlook, rows, back, onMore, ended, next }: {
  loan: LoanDetail;
  projectName: string | null;
  outlook: LoanOutlook | null;
  rows: readonly LoanBandRow[];
  back: string;
  /** Opens the close sheet; null for a viewer or a closed loan. */
  onMore: (() => void) | null;
  /** FLOW-138: a paid-off loan with nothing left shows no balance, only how it ended (the closed card). */
  ended: boolean;
  /** FLOW-1055: the next payment's card, last in the band (LoanNextCard). */
  next?: ReactNode;
}) {
  const goBack = useGoBack();
  const [mark, setMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(mark, true, BAND_BAR);
  const { paidMinor } = balanceProgress(loan);
  const more = onMore == null ? <span className="ui-loans-bar-slot" aria-hidden="true" /> : (
    <IconButton label="פעולות להלוואה" onBand onClick={onMore}>
      <MoreIcon />
    </IconButton>
  );
  return (
    <>
      <TopBand
        wordmark={false}
        leading={<BackButton fallback={back} text="הלוואות" onBand />}
        trailing={onMore == null ? null : more}
        hero={(
          <div className="ui-loan-band">
            <div className="ui-loan-band-name">
              <FocusTitle className="t-name">{loan.name}</FocusTitle>
              <p className="ui-loan-band-sub">{loanSubtitle(loan, projectName)}</p>
            </div>
            {ended ? null : <div className="ui-band-fade ui-loan-band-figures">
              <div className="ui-loan-band-balance">
                <p className="ui-loan-band-label">{loan.kind === "demand" ? "יתרת קרן" : "יתרה היום"}</p>
                <p className="ui-loan-band-figure"><Amount agorot={loan.balanceMinor} currency={loan.currency} size="hero" /></p>
              </div>
              {outlook == null && !(loan.kind === "demand" && loan.status === "open") ? null : (
                <div className="ui-loans-band-paid">
                  <PartsBar parts={[{ key: "paid", value: paidMinor, tone: "band-past" }]} total={loan.principalMinor} height={8} label="נפרע מהקרן" />
                  <p className="ui-loan-band-caption">{balanceProgressText(loan, outlook)}</p>
                </div>
              )}
              <div className="ui-loans-band-rows">
                {rows.map((row) => (
                  <p key={row.key} className="ui-loans-band-row">
                    <span className="ui-loans-band-row-label" data-clip-ok="">{row.label}</span>
                    <bdi dir="ltr">{row.value}</bdi>
                  </p>
                ))}
              </div>
              {next}
            </div>}
            <span ref={setMark} className="ui-compact-mark" aria-hidden="true" />
          </div>
        )}
      />
      <CompactBar
        title={loan.name}
        shown={barShown}
        tone="band"
        start={(
          <IconButton label="חזרה" onBand onClick={() => { goBack(back); }}>
            <BackIcon />
          </IconButton>
        )}
        centre={(
          <span className="ui-compact-bar-centre">
            <span className="ui-compact-bar-centre-title">{loan.name}</span>
            <span className="ui-compact-bar-centre-net"><Amount agorot={loan.balanceMinor} currency={loan.currency} presentation="detail" /></span>
          </span>
        )}
        end={more}
      />
    </>
  );
}

/**
 * FLOW-1046 (V3-Loan-Note): a loan whose payments wait for a check opens with this card. הפרטים נכונים marks it
 * checked on this device until the count changes (the attention cards' store, `flow.attention.loan:<id>`), with
 * ביטול; עריכה opens the first payment that waits.
 */
export function LoanCheckCard({ loanId, count, editHref, onChecked }: {
  loanId: string;
  count: number;
  editHref: string;
  /** After הפרטים נכונים: the page's toast with its undo. */
  onChecked: (undo: () => void) => void;
}) {
  const storageKey = `loan:${loanId}`;
  const row = { id: "check", dismissKey: `check:${String(count)}` };
  const [checked, setChecked] = useState(() => isRowHidden(readHidden(storageKey), row));
  if (checked) return null;
  return (
    <Card as="section" className="ui-loan-card ui-loan-check" aria-label="ממתין לבדיקה">
      <p className="ui-loan-check-title">
        {count === 1 ? "תשלום אחד ממתין לבדיקה" : `${String(count)} תשלומים ממתינים לבדיקה`}
      </p>
      <p className="ui-loan-card-text">הסכום, הריבית והפרויקט מולאו לפי התשלומים מהבנק. בדקו אותם לפני שהם נכנסים לדוחות.</p>
      <div className="ui-loan-check-actions">
        <Button
          onClick={() => {
            hideRow(storageKey, row.id, row.dismissKey);
            setChecked(true);
            onChecked(() => {
              restoreAll(storageKey);
              setChecked(false);
            });
          }}
        >
          הפרטים נכונים
        </Button>
        <Button variant="secondary" to={editHref}>עריכה</Button>
      </div>
    </Card>
  );
}

/**
 * FLOW-962 (board Loan closed early): how a closed loan ended, and that it left the forecast and the
 * debt. A refinance names the new loan, which opens; an owner without a link yet can add it.
 */
export function LoanClosedCard({ status, closedOn, link, onLink }: {
  status: LoanCloseReason;
  closedOn: string | null;
  link: { name: string; to: string } | null;
  /** Null for a viewer, or a loan paid off in full. */
  onLink: (() => void) | null;
}) {
  return (
    <Card as="section" className="ui-loan-card ui-loan-closed" aria-label="ההלוואה נסגרה">
      <p className="ui-loan-closed-line">
        <CheckIcon size={20} />
        {loanClosedLine(status, closedOn)}
      </p>
      <p className="ui-loan-card-text">{LOAN_CLOSED_NOTE[status]}</p>
      {link != null ? (
        <Link className="ui-loan-closed-link" to={link.to}>
          <span className="ui-loan-link-text">
            <span className="ui-loan-card-note">מומנה מחדש ב־</span>
            <span>{link.name}</span>
          </span>
          <ChevronIcon size={18} />
        </Link>
      ) : onLink != null ? (
        <button type="button" className="ui-loan-closed-link" onClick={onLink}>
          <span>קישור להלוואה החדשה</span>
          <ChevronIcon size={18} />
        </button>
      ) : null}
    </Card>
  );
}

/**
 * The next payment, one line: its date and figure, and its parts in a row ("קרן $1,066 · ריבית $1,087 · נאמנות $363").
 * FLOW-1046: the card opens the payments list on הבאים.
 */
export function LoanNextCard({ loan, outlook, to }: { loan: LoanDetail; outlook: LoanOutlook; to: string }) {
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
    <section className="ui-loan-next-card" aria-label="התשלום הבא">
      <Link className="ui-loan-next-link m-press" to={to}>
        <span className="ui-loan-next-text">
          <span className="ui-loan-next-title" data-clip-ok="">התשלום הבא · {dayMonth(next.dueDate)}</span>
          <span className="ui-loan-next-line" data-clip-ok="">{line}</span>
        </span>
        <bdi className="ui-loan-next-amount" dir="ltr">{loanMoney(loan, next.paymentMinor)}</bdi>
        <ChevronIcon size={18} />
      </Link>
    </section>
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
        {/* FLOW-1055 (V3-Loan): the card's title is שולם; the period's start stays for a screen reader. */}
        <h2 className="ui-loan-paid-title">
          <span aria-hidden="true">שולם</span>
          <span className="sr-only">{card.label}</span>
        </h2>
        <SegmentedControl<PaidPeriod>
          label="תקופה"
          showLabel={false}
          value={period}
          onChange={setPeriod}
          options={[{ value: "all", label: "מההתחלה" }, { value: "year", label: today.slice(0, 4), numeric: true }]}
        />
      </div>
      <bdi className="ui-loan-paid-total" dir="ltr">{wholeMoney(card.totalMinor, loan.currency)}</bdi>
      {shown.length === 0 ? null : (
        <PartsBar parts={shown.map(({ part, tone }) => ({ key: part, value: card.totals[part], tone }))} height={8} gap={2} label={card.label} />
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
                <bdi className="ui-loan-paid-amount" dir="ltr">{wholeMoney(card.totals[part], loan.currency)}</bdi>
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
export function PaymentRowLink({ row, currency, search, year }: {
  row: PaymentRow;
  currency: LoanCurrency;
  search: string;
  /** The page's year: a date in another year shows its year too. */
  year: string;
}) {
  const showYear = row.dateIso.slice(0, 4) !== year;
  const date = showYear ? `${row.date}/${row.dateIso.slice(0, 4)}` : row.date;
  return (
    <Link className={`ui-loan-row${row.needsReview ? " ui-loan-row-review" : ""}`} to={`/transactions/${row.transactionId}${search}`}>
      <span className="ui-loan-row-text">
        <bdi className="ui-loan-row-title" dir="ltr">{date}</bdi>
        <span className="ui-loan-row-note" data-clip-ok="">{row.needsReview ? "ממתין לבדיקה" : paymentSplitText(row, currency)}</span>
      </span>
      <bdi className="ui-loan-row-amount" dir="ltr">{formatLoanMoney(row.totalMinor, currency)}</bdi>
    </Link>
  );
}

/**
 * The last three payments under a one-line head with the link to all of them (V3-Loan, FLOW-1055): a section on
 * the page, not a card, its rows 64px with the split under the date.
 */
export function LoanRecentCard({ loan, payments, search, loanPath, year }: {
  loan: LoanDetail;
  payments: readonly LoanPayment[];
  search: string;
  loanPath: string;
  year: string;
}) {
  const rows = payments.slice(0, 3);
  return (
    <section className="ui-loan-recent" aria-labelledby="loan-recent-title">
      <div className="ui-loan-recent-head">
        <h2 id="loan-recent-title" className="ui-loan-card-title">{payments.length >= 3 ? "3 התשלומים האחרונים" : "התשלומים"}</h2>
        {payments.length === 0 ? null : <Link className="ui-loan-all" to={`${loanPath}/payments${search}`}>כל התשלומים</Link>}
      </div>
      {payments.length === 0 ? (
        // FLOW-962 (board Loan new): what will appear here, and the way to the bank.
        <div className="ui-loan-recent-empty">
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
            />
          ))}
        </>
      )}
    </section>
  );
}
