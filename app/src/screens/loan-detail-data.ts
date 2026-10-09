import {
  buildLoanSchedule,
  demandAccrual,
  LOAN_TERM_MONTHS_MAX,
  rateOnDate,
  regularPaymentMinor,
  type LoanKind,
  type LoanSplitPart,
  type LoanStatus,
} from "@flow/shared";
import { formatDisplay } from "../ui/date-math";
import { LOAN_KIND_LABEL, LOAN_STATUS_LABEL, loanPartsText } from "./loan-copy";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";

/** FLOW-106 B and FLOW-110: one loan's page, as the app reads it. Pure mappers, no reads. */

export type LoanRateRow = { id: string; effectiveDate: string; annualRatePpm: number };

export type LoanDetail = {
  id: string;
  companyId: string;
  name: string;
  currency: LoanCurrency;
  principalMinor: bigint;
  annualRatePpm: number;
  /** Null for a demand loan only. */
  termMonths: number | null;
  startDate: string;
  /** Null for a demand loan only. */
  paymentMinor: bigint | null;
  escrowMinor: bigint;
  kind: LoanKind;
  interestOnlyMonths: number | null;
  amortizationMonths: number | null;
  status: LoanStatus;
  closedOn: string | null;
  projectId: string | null;
  categoryIds: Record<LoanSplitPart, string | null>;
  /** Newest first. */
  rates: LoanRateRow[];
  balanceMinor: bigint;
  flaggedParts: number;
};

export type LoanPayment = {
  transactionId: string;
  docDate: string;
  needsReview: boolean;
  interestMinor: bigint;
  escrowMinor: bigint;
  principalMinor: bigint;
  feesMinor: bigint;
  totalMinor: bigint;
  /** 3, or 4 with fees. */
  parts: number;
};

export type LoanCategory = {
  id: string;
  name: string;
  kind: "expense" | "income";
  loanPart: LoanSplitPart | null;
  excludedFromPnl: boolean;
  hidden: boolean;
};

export const LOAN_PARTS: readonly LoanSplitPart[] = ["interest", "escrow", "principal", "fees"];

/** The loan's columns the page reads, with the rate rows embedded. */
export const LOAN_DETAIL_COLUMNS =
  "id, company_id, name, currency, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, kind, interest_only_months, amortization_months, status, closed_on, project_id, interest_category_id, escrow_category_id, principal_category_id, fees_category_id, loan_rates(id, effective_date, annual_rate_ppm)";

export type LoanDetailDbRow = {
  id: string;
  company_id: string;
  name: string;
  currency: string;
  principal_minor: number;
  annual_rate_ppm: number;
  term_months: number | null;
  start_date: string;
  payment_minor: number | null;
  escrow_minor: number;
  kind: LoanKind;
  interest_only_months: number | null;
  amortization_months: number | null;
  status: LoanStatus;
  closed_on: string | null;
  project_id: string | null;
  interest_category_id: string | null;
  escrow_category_id: string | null;
  principal_category_id: string | null;
  fees_category_id: string | null;
  loan_rates?: Array<{ id: string; effective_date: string; annual_rate_ppm: number }> | null;
};

function asLoanCurrency(currency: string): LoanCurrency {
  return currency === "USD" ? "USD" : "ILS";
}

export function readLoanRow(row: LoanDetailDbRow, balance: { balanceMinor: bigint; flaggedParts: number } | null): LoanDetail {
  const rates = (Array.isArray(row.loan_rates) ? row.loan_rates : [])
    .map((rate) => ({ id: rate.id, effectiveDate: rate.effective_date, annualRatePpm: rate.annual_rate_ppm }))
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0));
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    currency: asLoanCurrency(row.currency),
    principalMinor: BigInt(row.principal_minor),
    annualRatePpm: row.annual_rate_ppm,
    termMonths: row.term_months,
    startDate: row.start_date,
    paymentMinor: row.payment_minor == null ? null : BigInt(row.payment_minor),
    escrowMinor: BigInt(row.escrow_minor),
    kind: row.kind,
    interestOnlyMonths: row.interest_only_months,
    amortizationMonths: row.amortization_months,
    status: row.status,
    closedOn: row.closed_on,
    projectId: row.project_id,
    categoryIds: {
      interest: row.interest_category_id,
      escrow: row.escrow_category_id,
      principal: row.principal_category_id,
      fees: row.fees_category_id,
    },
    rates,
    // A loan with no balance row has nothing attached yet: its balance is the principal.
    balanceMinor: balance?.balanceMinor ?? BigInt(row.principal_minor),
    flaggedParts: balance?.flaggedParts ?? 0,
  };
}

function minorOf(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return 0n;
}

/** mcp_loan_payments, newest first. Anything that is not a payment row is left out. */
export function readLoanPayments(data: unknown): LoanPayment[] {
  if (!Array.isArray(data)) return [];
  const rows: LoanPayment[] = [];
  for (const raw of data as unknown[]) {
    if (raw == null || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = item.transaction_id;
    const date = item.doc_date;
    if (typeof id !== "string" || typeof date !== "string") continue;
    const interestMinor = minorOf(item.interest_minor);
    const escrowMinor = minorOf(item.escrow_minor);
    const principalMinor = minorOf(item.principal_minor);
    const feesMinor = minorOf(item.fees_minor);
    rows.push({
      transactionId: id,
      docDate: date,
      needsReview: item.needs_review === true,
      interestMinor,
      escrowMinor,
      principalMinor,
      feesMinor,
      totalMinor: interestMinor + escrowMinor + principalMinor + feesMinor,
      parts: feesMinor > 0n ? 4 : 3,
    });
  }
  return rows.sort((a, b) => (a.docDate < b.docDate ? 1 : a.docDate > b.docDate ? -1 : b.transactionId.localeCompare(a.transactionId)));
}

/** The payments section shows the last 3; "כל התשלומים" opens the rest. */
export const LOAN_PAYMENTS_SHOWN = 3;

/** "4 חלקים · עמלות ₪262.50", or "3 חלקים". A demand payment names its interest and principal. */
export function paymentHint(payment: LoanPayment, loan: Pick<LoanDetail, "kind" | "currency">): string {
  if (loan.kind === "demand") {
    return `ריבית ${formatLoanMoney(payment.interestMinor, loan.currency)} · קרן ${formatLoanMoney(payment.principalMinor, loan.currency)}`;
  }
  const parts = loanPartsText(payment.parts);
  return payment.feesMinor > 0n ? `${parts} · עמלות ${formatLoanMoney(payment.feesMinor, loan.currency)}` : parts;
}

/**
 * The categories a part can take, as private.loan_part_category_ok allows them: an expense
 * category whose loan_part is empty or the same part (fees also take the keyed interest
 * category); principal needs one kept out of the P&L, and interest, escrow and fees take
 * either (decision 0166: a hard-money loan's interest can stay out of profit). The keyed
 * category of the part itself is the default row, so it is left out here. Hidden categories
 * are left out unless the loan names one.
 */
export function partCategoryOptions(categories: readonly LoanCategory[], part: LoanSplitPart, currentId: string | null = null): LoanCategory[] {
  return categories.filter((category) => {
    if (category.kind !== "expense") return false;
    if (category.hidden && category.id !== currentId) return false;
    if (part !== "fees" && category.loanPart === part) return false;
    const partFits = category.loanPart == null
      || category.loanPart === part
      || (part === "fees" && category.loanPart === "interest");
    if (!partFits) return false;
    return part !== "principal" || category.excludedFromPnl;
  });
}

/** The keyed default category of a part (categories.loan_part). Fees have none (0130). */
export function keyedCategory(categories: readonly LoanCategory[], part: LoanSplitPart): LoanCategory | null {
  if (part === "fees") return null;
  return categories.find((category) => category.loanPart === part) ?? null;
}

export const FEES_NONE = "לא נקבעה · נבחר בכל תשלום";
export const FEES_NONE_ROW = "בלי קבועה";
export const FEES_NONE_DESC = "נבחר בכל תשלום עם עמלות";

/** The value a part's row shows: the loan's category, else the keyed default. */
export function partCategoryValue(loan: Pick<LoanDetail, "categoryIds">, categories: readonly LoanCategory[], part: LoanSplitPart): string {
  const id = loan.categoryIds[part];
  const own = id == null ? null : categories.find((category) => category.id === id);
  if (own) return own.name;
  if (part === "fees") return FEES_NONE;
  const keyed = keyedCategory(categories, part);
  return keyed ? `ברירת מחדל · ${keyed.name}` : "ברירת מחדל";
}

/** The first row of a part's sheet: the keyed default, or "no fixed category" for fees. */
export function partDefaultLabel(categories: readonly LoanCategory[], part: LoanSplitPart): string {
  if (part === "fees") return FEES_NONE_ROW;
  const keyed = keyedCategory(categories, part);
  return keyed ? `ברירת מחדל · ${keyed.name}` : "ברירת מחדל";
}

/** The parts a loan files: a demand loan has no escrow. */
export function loanParts(loan: Pick<LoanDetail, "kind">): LoanSplitPart[] {
  return loan.kind === "demand" ? ["interest", "principal", "fees"] : [...LOAN_PARTS];
}

/** 112500 → "11.25%", 60000 → "6%", 105000 → "10.5%", 8250 → "0.825%": no trailing zeros (FLOW-347, §3.5). */
export function formatRatePpm(ppm: number): string {
  const whole = Math.trunc(ppm / 10_000);
  const frac = String(Math.abs(ppm % 10_000)).padStart(4, "0").replace(/0+$/, "");
  return frac === "" ? `${String(whole)}%` : `${String(whole)}.${frac}%`;
}

/** The rate in force on a day, and the rate row it comes from (null: the loan's own rate). */
export function rateInForce(loan: Pick<LoanDetail, "annualRatePpm" | "rates">, today: string): { ppm: number; from: string | null } {
  const sorted = [...loan.rates].sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  const ppm = rateOnDate(loan.annualRatePpm, sorted.map((rate) => ({ effectiveDate: rate.effectiveDate, annualRatePpm: rate.annualRatePpm })), today);
  let from: string | null = null;
  for (const rate of sorted) if (rate.effectiveDate <= today) from = rate.effectiveDate;
  return { ppm, from };
}

/** "11.25% · מ־01/09/2026", or "6% · מההתחלה". */
export function rateValue(loan: Pick<LoanDetail, "annualRatePpm" | "rates">, today: string): string {
  const { ppm, from } = rateInForce(loan, today);
  return from == null ? `${formatRatePpm(ppm)} · מההתחלה` : `${formatRatePpm(ppm)} · מ־${formatDisplay(from)}`;
}

/** The סוג row: the kind and its months. */
export function kindValue(loan: Pick<LoanDetail, "kind" | "termMonths" | "interestOnlyMonths" | "amortizationMonths">): string {
  const label = LOAN_KIND_LABEL[loan.kind];
  switch (loan.kind) {
    case "amortizing":
      return loan.termMonths == null ? label : `${label} · ${String(loan.termMonths)} חודשים`;
    case "interest_only":
      return `${label} · ${String(loan.interestOnlyMonths ?? 0)} מתוך ${String(loan.termMonths ?? 0)} חודשים`;
    case "balloon":
      return `${label} · פריסה ${String(loan.amortizationMonths ?? 0)}, נגמרת אחרי ${String(loan.termMonths ?? 0)}`;
    case "demand":
      return `${label} · ריבית יומית, 365 יום`;
  }
}

function scheduleOf(loan: LoanDetail) {
  if (loan.kind === "demand" || loan.termMonths == null || loan.paymentMinor == null) return null;
  try {
    return buildLoanSchedule({
      principalMinor: loan.principalMinor,
      annualRatePpm: loan.annualRatePpm,
      termMonths: loan.termMonths,
      startDate: loan.startDate,
      paymentMinor: loan.paymentMinor,
      escrowMinor: loan.escrowMinor,
      kind: loan.kind,
      interestOnlyMonths: loan.interestOnlyMonths,
      amortizationMonths: loan.amortizationMonths,
      rates: [...loan.rates].reverse().map((rate) => ({ effectiveDate: rate.effectiveDate, annualRatePpm: rate.annualRatePpm })),
    });
  } catch {
    return null;
  }
}

/**
 * The תשלום חודשי row (read-only): the payment due next, then what follows it when it
 * changes. Null for a demand loan, which has no fixed payment.
 */
export function paymentValue(loan: LoanDetail, today: string): string | null {
  if (loan.kind === "demand" || loan.paymentMinor == null) return null;
  const schedule = scheduleOf(loan);
  if (schedule == null) return formatLoanMoney(loan.paymentMinor, loan.currency);
  const rows = schedule.rows;
  const next = rows.find((row) => row.dueDate >= today) ?? rows.at(-1) ?? null;
  const now = next?.paymentMinor ?? loan.paymentMinor;
  const shown = formatLoanMoney(now, loan.currency);
  if (loan.kind === "interest_only" && next != null && loan.interestOnlyMonths != null && next.period <= loan.interestOnlyMonths && loan.interestOnlyMonths < (loan.termMonths ?? 0)) {
    const after = rows[loan.interestOnlyMonths]?.paymentMinor ?? loan.paymentMinor;
    return `${shown} · אחר כך ${formatLoanMoney(after, loan.currency)}`;
  }
  if (loan.kind === "balloon" && schedule.balloon != null) {
    const last = rows.at(-1);
    return `${shown} · בלון ${formatLoanMoney(schedule.balloon.amountMinor, loan.currency)}${last ? ` ב־${formatDisplay(last.dueDate)}` : ""}`;
  }
  return shown;
}

/** Interest accrued on a demand loan today, from its attached payments (decision 0132). */
export function demandInterestToday(loan: LoanDetail, payments: readonly LoanPayment[], today: string): bigint | null {
  if (loan.kind !== "demand") return null;
  try {
    return demandAccrual(
      {
        principalMinor: loan.principalMinor,
        annualRatePpm: loan.annualRatePpm,
        startDate: loan.startDate,
        rates: [...loan.rates].reverse().map((rate) => ({ effectiveDate: rate.effectiveDate, annualRatePpm: rate.annualRatePpm })),
      },
      payments.filter((payment) => !payment.needsReview).map((payment) => ({
        date: payment.docDate,
        interestMinor: payment.interestMinor,
        escrowMinor: payment.escrowMinor,
        principalMinor: payment.principalMinor,
        feesMinor: payment.feesMinor,
      })),
      today,
    ).interestMinor;
  } catch {
    return null;
  }
}

/** The status sheet's date floor: the last attached payment. Null when nothing is attached. */
export function lastPaymentDate(payments: readonly LoanPayment[]): string | null {
  let last: string | null = null;
  for (const payment of payments) if (last == null || payment.docDate > last) last = payment.docDate;
  return last;
}

/** The date sheet opens on the last payment's date, else today (plan §3.2). */
export function closeDateDefault(loan: Pick<LoanDetail, "closedOn">, payments: readonly LoanPayment[], today: string): string {
  if (loan.closedOn != null) return loan.closedOn;
  return lastPaymentDate(payments) ?? today;
}

/** The pill under the balance. */
export function statusPill(loan: Pick<LoanDetail, "status" | "closedOn">): string {
  if (loan.status === "open" || loan.closedOn == null) return LOAN_STATUS_LABEL[loan.status];
  return `${LOAN_STATUS_LABEL[loan.status]} · ${formatDisplay(loan.closedOn)}`;
}

/** The toast after a status change. A paid-off loan with a balance left says so (0122 allows it). */
export function statusToast(status: LoanStatus, balanceMinor: bigint, currency: LoanCurrency): string {
  if (status === "open") return "ההלוואה נפתחה מחדש";
  if (status === "paid_off" && balanceMinor > 0n) return `סומנה כנפרעה · נשארה יתרה ${formatLoanMoney(balanceMinor, currency)} בספרים`;
  return status === "paid_off" ? "סומנה כנפרעה" : "סומנה כנסגרה";
}

/** One kind choice in the סוג sheet: its one-line description. */
export const LOAN_KIND_DESCRIPTION: Record<LoanKind, string> = {
  amortizing: "תשלום חודשי קבוע עד סוף התקופה",
  interest_only: "בחודשים הראשונים משלמים רק ריבית",
  balloon: "תשלום לפי פריסה ארוכה, היתרה בסוף התקופה",
  demand: "בלי תקופה ובלי לוח. ריבית יומית על היתרה",
};

export type LoanKindDraft = { kind: LoanKind; months: string };

/** What the סוג sheet writes for a kind, or an error code when its field is not valid. */
export function kindPatch(
  loan: Pick<LoanDetail, "kind" | "termMonths" | "principalMinor" | "annualRatePpm" | "escrowMinor">,
  draft: LoanKindDraft,
):
  | { ok: true; patch: { kind: LoanKind; interest_only_months: number | null; amortization_months: number | null; term_months: number | null; payment_minor: number | null; escrow_minor: number } }
  | { ok: false; error: "months" | "term" } {
  if (draft.kind === "demand") {
    return { ok: true, patch: { kind: "demand", interest_only_months: null, amortization_months: null, term_months: null, payment_minor: null, escrow_minor: 0 } };
  }
  const term = loan.termMonths;
  if (term == null) return { ok: false, error: "term" };
  const months = /^\d+$/.test(draft.months.trim()) ? Number(draft.months.trim()) : Number.NaN;
  const io = draft.kind === "interest_only" ? months : null;
  const amortization = draft.kind === "balloon" ? months : null;
  if (io != null && !(io >= 1 && io <= term)) return { ok: false, error: "months" };
  if (amortization != null && !(amortization >= term && amortization <= LOAN_TERM_MONTHS_MAX)) return { ok: false, error: "months" };
  const payment = regularPaymentMinor({
    principalMinor: loan.principalMinor,
    annualRatePpm: loan.annualRatePpm,
    termMonths: term,
    escrowMinor: loan.escrowMinor,
    kind: draft.kind,
    interestOnlyMonths: io,
    amortizationMonths: amortization,
  });
  return {
    ok: true,
    patch: {
      kind: draft.kind,
      interest_only_months: io,
      amortization_months: amortization,
      term_months: term,
      payment_minor: Number(payment),
      escrow_minor: Number(loan.escrowMinor),
    },
  };
}

/** The months field's starting value for a kind. */
export function kindMonthsDefault(loan: Pick<LoanDetail, "kind" | "termMonths" | "interestOnlyMonths" | "amortizationMonths">, kind: LoanKind): string {
  if (kind === "interest_only") return String(loan.interestOnlyMonths ?? Math.min(12, loan.termMonths ?? 12));
  if (kind === "balloon") return String(loan.amortizationMonths ?? Math.max(360, loan.termMonths ?? 360));
  return "";
}

/** The rate sheet takes a percent with up to 4 decimals, 0 to 100. Null when it is not one. */
export function ratePpmOfInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(trimmed)) return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const ppm = Number(whole) * 10_000 + Number(frac.padEnd(4, "0"));
  if (!Number.isSafeInteger(ppm) || ppm > 1_000_000) return null;
  return ppm;
}

/** 112500 → "11.25" for the rate field. */
export function rateInput(ppm: number): string {
  return formatRatePpm(ppm).replace("%", "");
}
