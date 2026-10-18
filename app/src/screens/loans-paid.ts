import type { LoanSplitPart } from "@flow/shared";
import { LOAN_STATUS_LABEL } from "./loan-copy";
import type { LoanDetail, LoanPayment } from "./loan-detail-data";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";
import { paidInPeriod, type PartTotals } from "./loan-outlook";
import { monthYear, wholeMoney } from "./loan-detail-view-data";

/**
 * What was paid on the loans, since they started or in this calendar year: the loan page's שולם card
 * and the loans summary page (/loans/summary, the board's Loans · summary). Pure, no reads. Every
 * amount comes from the payments attached to the loans, the same rows the all-payments page lists.
 */

/** מתחילת ההלוואות (since each loan started) or the calendar year of today. */
export type PaidPeriod = "all" | "year";

/** The parts in the order the cards draw them, with their bar tone. */
export const PAID_PARTS: ReadonlyArray<{ part: LoanSplitPart; tone: "accent" | "accent-dim" | "muted" | "band-past" }> = [
  { part: "principal", tone: "accent" },
  { part: "interest", tone: "accent-dim" },
  { part: "escrow", tone: "muted" },
  { part: "fees", tone: "band-past" },
];

/** An amount with its cents when it has some ($5,512.50), whole otherwise ($87,200): the board's rule for paid sums. */
export function paidMoney(minor: bigint, currency: LoanCurrency): string {
  return minor % 100n === 0n ? wholeMoney(minor, currency) : formatLoanMoney(minor, currency);
}

/** A share in whole percent; 0 when there is no whole. */
export function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  return Math.min(100, Math.round(Number((part * 1000n) / whole) / 10));
}

function periodKey(period: PaidPeriod, year: string): string {
  return period === "all" ? "all" : year;
}

function sumParts(list: readonly PartTotals[]): PartTotals {
  const out: PartTotals = { principal: 0n, interest: 0n, escrow: 0n, fees: 0n };
  for (const totals of list) for (const key of Object.keys(out) as LoanSplitPart[]) out[key] += totals[key];
  return out;
}

/**
 * What a loan paid in the period. Since the start, the principal is the original amount less today's
 * balance (the balance card's own figure); in a year it is the principal parts of that year's
 * payments. Interest, escrow and fees are always the saved splits of the attached payments.
 */
export function loanPaidParts(loan: Pick<LoanDetail, "principalMinor" | "balanceMinor">, payments: readonly LoanPayment[], period: PaidPeriod, year: string): { totals: PartTotals; payments: number } {
  const paid = paidInPeriod(payments, periodKey(period, year));
  if (period === "year") return { totals: paid.totals, payments: paid.payments };
  const repaid = loan.principalMinor - loan.balanceMinor;
  return { totals: { ...paid.totals, principal: repaid > 0n ? repaid : 0n }, payments: paid.payments };
}

export function partsTotal(totals: PartTotals): bigint {
  return totals.principal + totals.interest + totals.escrow + totals.fees;
}

export type LoanPaidEntry = { loan: LoanDetail; payments: readonly LoanPayment[] };

export type LoansPaidLoan = {
  id: string;
  name: string;
  initial: string;
  paidMinor: bigint;
  /** "נשאר $176,500 · נפרע 26%", or "נשאר $294,000 · ריבית בלבד". */
  meta: string;
  /** The share of the principal paid off in the period, for the row's thin bar. */
  percent: number;
};

export type LoansPaid = {
  openCount: number;
  /** "4 פעילות · מאז 01/2025, ההלוואה הראשונה", or "… · מ־01/01/2026 עד היום". */
  sub: string;
  /** החוב בהתחלה, or the debt on 1 January for the year. */
  startLabel: string;
  startMinor: bigint;
  leftMinor: bigint;
  /** The principal paid off in the period. */
  repaidMinor: bigint;
  repaidPercent: number;
  repaidLabel: string;
  totalLabel: string;
  totals: PartTotals;
  totalMinor: bigint;
  note: string;
  loans: LoansPaidLoan[];
  /** The loans that ended, which the sums above leave out. Null when none did. */
  closed: { title: string; note: string } | null;
};

/**
 * The summary page's figures for the open loans of one currency (amounts in two currencies do not add).
 * The debt at the start is the loans' principal (all) or today's balance plus this year's principal
 * (year), so start − left is what was paid off. A loan that is not open is left out of the sums and
 * named in the closed line instead.
 */
export function loansPaid(entries: readonly LoanPaidEntry[], currency: LoanCurrency, period: PaidPeriod, today: string): LoansPaid {
  const year = today.slice(0, 4);
  const mine = entries.filter((entry) => entry.loan.currency === currency);
  const open = mine.filter((entry) => entry.loan.status === "open").sort((a, b) => a.loan.name.localeCompare(b.loan.name, "he") || a.loan.id.localeCompare(b.loan.id));
  const ended = mine.filter((entry) => entry.loan.status !== "open");
  const paid = open.map((entry) => loanPaidParts(entry.loan, entry.payments, period, year).totals);
  const totals = sumParts(paid);
  const totalMinor = partsTotal(totals);
  const leftMinor = open.reduce((sum, entry) => sum + entry.loan.balanceMinor, 0n);
  const startMinor = period === "all"
    ? open.reduce((sum, entry) => sum + entry.loan.principalMinor, 0n)
    : leftMinor + totals.principal;
  const repaid = startMinor - leftMinor;
  const repaidMinor = repaid > 0n ? repaid : 0n;
  const repaidPercent = percentOf(repaidMinor, startMinor);
  const first = open.reduce<string | null>((min, entry) => (min == null || entry.loan.startDate < min ? entry.loan.startDate : min), null);
  const since = period === "year" ? `מ־01/01/${year} עד היום` : first == null ? null : `מאז ${monthYear(first)}, ההלוואה הראשונה`;
  const loans = open.map((entry, index): LoansPaidLoan => {
    const parts = paid[index] ?? totals;
    const { loan } = entry;
    const paidOff = period === "year" ? parts.principal : loan.principalMinor - loan.balanceMinor;
    const base = period === "year" ? loan.balanceMinor + parts.principal : loan.principalMinor;
    const percent = percentOf(paidOff, base);
    return {
      id: loan.id,
      name: loan.name,
      initial: loan.name.trim().slice(0, 1),
      paidMinor: partsTotal(parts),
      meta: [
        `נשאר ${wholeMoney(loan.balanceMinor, currency)}`,
        loan.kind === "interest_only" ? "ריבית בלבד" : `נפרע ${String(percent)}%`,
        // No saved splits: the sum is the principal alone, and the row says so.
        entry.payments.length === 0 ? "רק קרן, אין פיצול" : null,
      ].filter((part) => part != null).join(" · "),
      percent,
    };
  });
  return {
    openCount: open.length,
    sub: [`${String(open.length)} פעילות`, since].filter((part) => part != null).join(" · "),
    startLabel: period === "year" ? `החוב ב־01/01/${year}` : "החוב בהתחלה",
    startMinor,
    leftMinor,
    repaidMinor,
    repaidPercent,
    repaidLabel: `${period === "year" ? "נפרע השנה מהקרן" : "נפרע מהקרן"} · ${String(repaidPercent)}%`,
    totalLabel: period === "year" ? `שולם ב־${year}` : "שולם מתחילת ההלוואות",
    totals,
    totalMinor,
    note: `הריבית היא מה שההלוואות עלו: ${paidMoney(totals.interest, currency)} ${period === "year" ? "השנה" : "עד היום"}.${totals.escrow > 0n ? " נאמנות (escrow) הולכת למסים ולביטוח של הנכס." : ""}`,
    loans,
    closed: closedLine(ended.map((entry) => entry.loan), period),
  };
}

/** "נסגרה · <name>" with when it ended, or how many ended; the sums above leave them out. */
function closedLine(loans: readonly LoanDetail[], period: PaidPeriod): LoansPaid["closed"] {
  if (loans.length === 0) return null;
  const where = period === "all" ? ", אפשר לראות אותן ברשימת הנסגרות" : "";
  const only = loans.length === 1 ? loans[0] : undefined;
  if (only == null) return { title: `${String(loans.length)} הלוואות נסגרו`, note: `לא בסכומים למעלה${where}` };
  const status = LOAN_STATUS_LABEL[only.status];
  const when = only.closedOn == null ? status : `${status} ב־${monthYear(only.closedOn)}`;
  return {
    title: `${status} · ${only.name}`,
    note: `${when} · לא בסכומים למעלה${period === "all" ? ", אפשר לראות אותה ברשימת הנסגרות" : ""}`,
  };
}

export type LoanPaidCardData = {
  label: string;
  totals: PartTotals;
  totalMinor: bigint;
  payments: number;
  note: string;
};

/** The loan page's שולם card: "שולם מאז 01/2025" or "שולם ב־2026", the parts, and what the interest cost. */
export function loanPaidCard(loan: Pick<LoanDetail, "startDate" | "principalMinor" | "balanceMinor">, payments: readonly LoanPayment[], period: PaidPeriod, today: string): LoanPaidCardData {
  const year = today.slice(0, 4);
  const paid = loanPaidParts(loan, payments, period, year);
  const note = payments.length === 0
    ? "אין עדיין תשלומים משויכים: רק הקרן שנפרעה, בלי ריבית ונאמנות."
    : paid.payments === 0 ? `אין תשלומים ב־${year}.` : `הריבית היא מה שההלוואה עלתה ${period === "year" ? "השנה" : "עד היום"}.`;
  return {
    label: period === "year" ? `שולם ב־${year}` : `שולם מאז ${monthYear(loan.startDate)}`,
    totals: paid.totals,
    totalMinor: partsTotal(paid.totals),
    payments: paid.payments,
    note,
  };
}
