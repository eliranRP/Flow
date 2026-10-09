import {
  allocateLoanSplit,
  buildLoanSchedule,
  demandAccrual,
  firstUnpaidRowIndex,
  loanTakesPaymentOn,
  paidInterestAndPrincipal,
  scheduleRowForDate,
  sumScheduleRows,
  type LoanSplitAmount,
} from "@flow/shared";
import { formatDisplay } from "../ui/date-math";
import type { LoanPayment } from "./loan-detail-data";
import type { LoanChoice, SavePart } from "./loan-match-api";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";

/** The most installments one line may cover (decision 0130). */
export const LOAN_INSTALLMENTS_MAX = 12;

/** The line a loan is offered for. */
export type OfferLine = {
  transactionId: string;
  docDate: string;
  lineMinor: bigint;
  currency: string;
};

/**
 * FLOW-106 §3.4. One loan's row in the match sheet: what one tap writes, said in its description,
 * or why the loan cannot take this line. `parts` is null exactly when `disabledReason` is set.
 */
export type LoanOffer = {
  loanId: string;
  description?: string;
  disabledReason?: string;
  parts: SavePart[] | null;
};

function money(minor: bigint, currency: string): string {
  const known: LoanCurrency = currency === "USD" ? "USD" : "ILS";
  return formatLoanMoney(minor, known);
}

function saveParts(parts: readonly LoanSplitAmount[]): SavePart[] {
  // The server files each part under the loan's category, else the keyed default (0128).
  return parts.map((part) => ({
    part: part.part,
    amount_minor: Number(part.amountMinor),
    scheduled_minor: Number(part.scheduledMinor),
  }));
}

function closedReason(loan: LoanChoice): string {
  const day = loan.closedOn == null ? "" : `ב־${formatDisplay(loan.closedOn)}`;
  const word = loan.status === "paid_off" ? "נפרעה" : "נסגרה";
  return day === "" ? `ההלוואה ${word}` : `${word} ${day}`;
}

/** What a demand loan's one tap writes: the interest accrued to the line's date, the rest to principal (0132). */
function demandOffer(loan: LoanChoice, payments: readonly LoanPayment[], line: OfferLine): LoanOffer {
  if (line.docDate < loan.startDate) return { loanId: loan.id, disabledReason: "לפני תחילת ההלוואה", parts: null };
  // Interest runs from the last payment, so a new payment comes after every other one (save_loan_split).
  const counted = payments.filter((payment) => !payment.needsReview && payment.transactionId !== line.transactionId);
  if (counted.some((payment) => payment.docDate > line.docDate)) {
    return { loanId: loan.id, disabledReason: "יש תשלום מאוחר יותר", parts: null };
  }
  const accrued = demandAccrual(
    {
      principalMinor: BigInt(loan.principalMinor),
      annualRatePpm: loan.annualRatePpm,
      startDate: loan.startDate,
      rates: loan.rates ?? [],
    },
    counted.map((payment) => ({
      date: payment.docDate,
      interestMinor: payment.interestMinor,
      escrowMinor: payment.escrowMinor,
      principalMinor: payment.principalMinor,
      feesMinor: payment.feesMinor,
    })),
    line.docDate,
  ).interestMinor;
  const parts = allocateLoanSplit({ lineMinor: line.lineMinor, interestMinor: accrued, escrowMinor: 0n, principalMinor: 0n });
  return {
    loanId: loan.id,
    description: `ריבית צבורה ${money(accrued, loan.currency)} · השאר לקרן`,
    parts: saveParts(parts),
  };
}

/**
 * What a scheduled loan's one tap writes: the schedule row for the line's date, or, when the line
 * equals 2 to 12 consecutive unpaid rows to the cent, those rows together (a catch-up payment).
 */
function scheduledOffer(loan: LoanChoice, payments: readonly LoanPayment[], line: OfferLine): LoanOffer {
  if (loan.termMonths == null || loan.paymentMinor == null) {
    return { loanId: loan.id, disabledReason: "אין לוח סילוקין", parts: null };
  }
  const schedule = buildLoanSchedule({
    principalMinor: BigInt(loan.principalMinor),
    annualRatePpm: loan.annualRatePpm,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    paymentMinor: BigInt(loan.paymentMinor),
    escrowMinor: BigInt(loan.escrowMinor),
    kind: loan.kind,
    interestOnlyMonths: loan.interestOnlyMonths ?? null,
    amortizationMonths: loan.amortizationMonths ?? null,
    rates: loan.rates ?? [],
  });
  const paid = paidInterestAndPrincipal(payments.map((payment) => ({
    transactionId: payment.transactionId,
    interestMinor: payment.interestMinor,
    principalMinor: payment.principalMinor,
    needsReview: payment.needsReview,
  })), line.transactionId);
  const first = firstUnpaidRowIndex(schedule.rows, paid);
  if (first >= 0) {
    for (let count = 2; count <= LOAN_INSTALLMENTS_MAX; count += 1) {
      const sum = sumScheduleRows(schedule.rows, first, count);
      if (sum == null) break;
      const total = sum.interestMinor + sum.escrowMinor + sum.principalMinor;
      if (total > line.lineMinor) break;
      if (total === line.lineMinor) {
        return {
          loanId: loan.id,
          description: `${String(count)} תשלומים לפי הלוח · ${money(total, loan.currency)}`,
          parts: saveParts(allocateLoanSplit({ lineMinor: line.lineMinor, ...sum })),
        };
      }
    }
  }
  const row = scheduleRowForDate(schedule.rows, line.docDate);
  if (row == null) return { loanId: loan.id, disabledReason: "לפני תחילת ההלוואה", parts: null };
  const parts = allocateLoanSplit({
    lineMinor: line.lineMinor,
    interestMinor: row.interestMinor,
    escrowMinor: row.escrowMinor,
    principalMinor: row.principalMinor,
  });
  return {
    loanId: loan.id,
    description: `לפי הלוח · ${money(row.interestMinor + row.escrowMinor + row.principalMinor, loan.currency)}`,
    parts: saveParts(parts),
  };
}

/** One loan's row in the match sheet for this line (FLOW-106 §3.4). */
export function loanOffer(loan: LoanChoice, payments: readonly LoanPayment[], line: OfferLine): LoanOffer {
  if (loan.balanceMinor <= 0n) return { loanId: loan.id, disabledReason: "ההלוואה נפרעה", parts: null };
  if (!loanTakesPaymentOn(loan, line.docDate)) return { loanId: loan.id, disabledReason: closedReason(loan), parts: null };
  const offer = loan.kind === "demand" ? demandOffer(loan, payments, line) : scheduledOffer(loan, payments, line);
  if (offer.parts == null) return offer;
  const principal = BigInt(offer.parts.find((part) => part.part === "principal")?.amount_minor ?? 0);
  if (principal > loan.balanceMinor) return { loanId: loan.id, disabledReason: "התשלום גבוה מיתרת ההלוואה", parts: null };
  return offer;
}

/** Open loans first, then the ones that cannot take the line; each group keeps its order. */
export function sortedOffers(offers: readonly LoanOffer[]): LoanOffer[] {
  return [...offers.filter((offer) => offer.parts != null), ...offers.filter((offer) => offer.parts == null)];
}
