import type { LoanSplitPart } from "@flow/shared";
import { Card } from "../ui/card";
import { PartsBar, type BarLegendItem, type BarPart } from "../ui/parts-bar";
import { PaymentRowLink } from "./loan-detail-cards";
import { LOAN_PART_BOARD_LABEL, loanPaymentYears, monthYear, paymentTotals, wholeMoney } from "./loan-detail-view-data";
import type { LoanDetail, LoanPayment } from "./loan-detail-data";

/**
 * FLOW-139c: `/loans/:id/payments`, every payment the loan has (board: Loan payments). A header
 * with the total paid, the split of the total, then one section per year, newest first; each
 * section's year head sticks under the top bar until the next year's head pushes it out.
 */
export function LoanPaymentsView({ loan, payments, projectName, search }: {
  loan: LoanDetail;
  payments: readonly LoanPayment[];
  projectName: string | null;
  search: string;
}) {
  const totals = paymentTotals(payments);
  const years = loanPaymentYears(payments);
  const shares: { key: LoanSplitPart; value: bigint; tone: BarPart["tone"] }[] = [
    { key: "principal", value: totals.principal, tone: "accent" },
    { key: "interest", value: totals.interest, tone: "accent-dim" },
    { key: "escrow", value: totals.escrow, tone: "muted" },
    { key: "fees", value: totals.fees, tone: "band-past" },
  ];
  const shown = shares.filter((part) => part.value > 0n);
  const bars: BarPart[] = shown.map((part) => ({ key: part.key, value: part.value, tone: part.tone }));
  const legend: BarLegendItem[] = shown.map((part) => ({
    key: part.key,
    label: LOAN_PART_BOARD_LABEL[part.key],
    value: <bdi dir="ltr">{wholeMoney(part.value, loan.currency)}</bdi>,
  }));
  const sub = [`${String(payments.length)} תשלומים מאז ${monthYear(loan.startDate)}`, projectName].filter((item) => item != null).join(" · ");
  return (
    <div className="ui-loan-payments">
      <header className="ui-loan-payments-head">
        <span className="ui-loan-chip">כל התשלומים</span>
        <h1 className="ui-loan-name">{loan.name}</h1>
        <p className="ui-loan-payments-total"><bdi dir="ltr">{wholeMoney(totals.total, loan.currency)}</bdi></p>
        <p className="ui-loan-payments-sub">{sub}</p>
      </header>
      {payments.length === 0 ? (
        <p className="ui-page-pad t-hint">אין עדיין תשלומים משויכים.</p>
      ) : (
        <>
          <Card className="ui-loan-card ui-loan-split">
            <PartsBar parts={bars} height={8} gap={2} radius="block" legend={legend} label="חלוקת כל התשלומים" />
          </Card>
          {years.map((year) => (
            <section key={year.year} className="ui-loan-year" aria-label={year.year}>
              <header className="ui-loan-year-head">
                <h2 className="ui-loan-year-title">
                  {year.year}
                  <span className="ui-loan-year-count"> · {String(year.count)} תשלומים</span>
                </h2>
                <bdi className="ui-loan-year-total" dir="ltr">{wholeMoney(year.totalMinor, loan.currency)}</bdi>
              </header>
              {year.rows.map((row) => (
                <PaymentRowLink key={row.transactionId} row={row} currency={loan.currency} search={search} year={year.year} />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
