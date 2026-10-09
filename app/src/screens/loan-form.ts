import {
  buildLoanSchedule,
  contractualPaymentMinor,
  LOAN_TERM_MONTHS_MAX,
  LoanScheduleError,
  parseDecimalHalfEven,
  regularPaymentMinor,
  type LoanBalloon,
  type LoanFinalAdjustment,
  type LoanKind,
  type LoanSchedule,
} from "@flow/shared";
import { israelToday } from "../ui/date-math";
import { readCompanyCurrency } from "../company-currency";

export type LoanCurrency = "ILS" | "USD";

export const LOAN_CURRENCY_MARK: Record<LoanCurrency, string> = {
  ILS: "₪",
  USD: "$",
};

const SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/** A loan is in shekels or dollars: dollars for a USD company, shekels for any other (0147). */
export function companyLoanCurrency(baseCurrency: string): LoanCurrency {
  return baseCurrency === "USD" ? "USD" : "ILS";
}

/** First day of next month in Asia/Jerusalem. */
export function firstOfNextMonth(now = new Date()): string {
  const today = israelToday(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear)}-${String(nextMonth).padStart(2, "0")}-01`;
}

export function formatLoanMoney(minor: bigint, currency: LoanCurrency): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const sign = negative ? "−" : "";
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = abs % 100n;
  const mark = LOAN_CURRENCY_MARK[currency];
  if (frac === 0n) return `${sign}${mark}${whole}`;
  return `${sign}${mark}${whole}.${frac.toString().padStart(2, "0")}`;
}

export function minorToInput(minor: bigint): string {
  const whole = minor / 100n;
  const frac = minor % 100n;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}

export type LoanDraft = {
  name: string;
  principal: string;
  rate: string;
  term: string;
  startDate: string;
  escrow: string;
  currency: LoanCurrency;
  /** Null uses the computed payment. A string is the advanced override. */
  payment: string | null;
  /** FLOW-106 §3.3. Missing reads as amortizing. */
  kind?: LoanKind;
  /** Interest-only: the interest-only months. Balloon: the amortization months. */
  kindMonths?: string;
};

export type LoanInsert = {
  company_id: string;
  name: string;
  principal_minor: number;
  annual_rate_ppm: number;
  /** Null for a demand loan only (loans_kind_chk). */
  term_months: number | null;
  start_date: string;
  /** Null for a demand loan only. */
  payment_minor: number | null;
  escrow_minor: number;
  currency: LoanCurrency;
  kind?: LoanKind;
  interest_only_months?: number | null;
  amortization_months?: number | null;
  /** FLOW-119. Optional project (decision 0105). */
  project_id?: string | null;
};

export type LoanPreview =
  | { status: "empty" }
  | { status: "error"; code: string }
  | {
      status: "ready";
      kind: LoanKind;
      /** 0 for a demand loan, which has no fixed payment. */
      paymentMinor: bigint;
      interestMinor: bigint;
      escrowMinor: bigint;
      balloon: LoanBalloon | null;
      /** The schedule's adjusted final payment. Null on an early payoff. */
      finalAdjustment: LoanFinalAdjustment | null;
      /**
       * Set when the final principal-and-interest is at least twice the regular
       * one, and the loan is not a balloon. Escrow is left out of both sides.
       * The sheet shows this instead of the adjusted line, with the amount once.
       */
      largeFinalMinor: bigint | null;
      insert: Omit<LoanInsert, "company_id">;
    };

export type LoanField = "name" | "principal" | "rate" | "term" | "escrow" | "payment" | "months";

export type LoanFieldErrors = Partial<Record<LoanField, string>>;

export type LoanFinalLine = {
  tone: "plain" | "caution";
  lead: string;
  /**
   * Above twice: the ratio floored to one decimal, and never below 2.1.
   * A trailing zero is dropped, so 3.0 is "3".
   */
  times?: string;
  amountMinor: bigint;
};

function minorOf(text: string): bigint | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    const minor = parseDecimalHalfEven(trimmed.replace(/[\s,]/g, ""), 2);
    if (minor < 0n || minor > SAFE_MINOR) return null;
    return minor;
  } catch {
    return null;
  }
}

function ratePpmOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.endsWith(".")) return null;
  try {
    const ppm = parseDecimalHalfEven(trimmed, 4);
    if (ppm < 0n || ppm > 1_000_000n) return null;
    return Number(ppm);
  } catch {
    return null;
  }
}

function largeFinal(schedule: LoanSchedule, paymentMinor: bigint, escrowMinor: bigint): bigint | null {
  if (schedule.balloon != null) return null;
  const last = schedule.rows.at(-1);
  if (last == null) return null;
  const pi = paymentMinor - escrowMinor;
  const finalPi = last.paymentMinor - last.escrowMinor;
  if (finalPi < pi * 2n) return null;
  return last.paymentMinor;
}

function termOf(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const term = Number(text);
  if (!Number.isSafeInteger(term) || term < 1 || term > LOAN_TERM_MONTHS_MAX) return null;
  return term;
}

/** The months field's starting value for a kind on the new-loan form (the loan page's defaults). */
export function newLoanKindMonths(kind: LoanKind, term: string): string {
  const months = termOf(term);
  if (kind === "interest_only") return String(Math.min(12, months ?? 12));
  if (kind === "balloon") return String(Math.max(360, months ?? 360));
  return "";
}

function monthsOf(text: string | undefined): number | null {
  return text != null && /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** A demand loan: no term, no fixed payment, no escrow; interest accrues daily (decision 0132). */
function demandPreview(draft: LoanDraft): LoanPreview {
  const principalMinor = minorOf(draft.principal);
  const ratePpm = ratePpmOf(draft.rate);
  if (principalMinor == null || principalMinor <= 0n || ratePpm == null) {
    if (draft.rate.trim() !== "" && !draft.rate.trim().endsWith(".") && ratePpmOf(draft.rate) == null) {
      return { status: "error", code: "rate" };
    }
    return { status: "empty" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) return { status: "error", code: "start_date" };
  return {
    status: "ready",
    kind: "demand",
    paymentMinor: 0n,
    interestMinor: 0n,
    escrowMinor: 0n,
    balloon: null,
    finalAdjustment: null,
    largeFinalMinor: null,
    insert: {
      name: draft.name.trim(),
      principal_minor: Number(principalMinor),
      annual_rate_ppm: ratePpm,
      term_months: null,
      start_date: draft.startDate,
      payment_minor: null,
      escrow_minor: 0,
      currency: draft.currency,
      kind: "demand",
      interest_only_months: null,
      amortization_months: null,
    },
  };
}

export function loanPreview(draft: LoanDraft): LoanPreview {
  const kind = draft.kind ?? "amortizing";
  if (kind === "demand") return demandPreview(draft);
  const principalMinor = minorOf(draft.principal);
  const escrowText = draft.escrow.trim() === "" ? "0" : draft.escrow;
  const escrowMinor = minorOf(escrowText);
  const ratePpm = ratePpmOf(draft.rate);
  const termMonths = termOf(draft.term);
  if (principalMinor == null || principalMinor <= 0n || escrowMinor == null || ratePpm == null || termMonths == null) {
    if (draft.rate.trim() !== "" && !draft.rate.trim().endsWith(".") && ratePpmOf(draft.rate) == null) {
      return { status: "error", code: "rate" };
    }
    if (/^\d+$/.test(draft.term) && termOf(draft.term) == null) return { status: "error", code: "term" };
    return { status: "empty" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) return { status: "error", code: "start_date" };

  const io = kind === "interest_only" ? monthsOf(draft.kindMonths) : null;
  const amortization = kind === "balloon" ? monthsOf(draft.kindMonths) : null;
  try {
    const levelPi = kind === "amortizing"
      ? contractualPaymentMinor({ principalMinor, annualRatePpm: ratePpm, termMonths }) + escrowMinor
      : regularPaymentMinor({ principalMinor, annualRatePpm: ratePpm, termMonths, escrowMinor, kind, interestOnlyMonths: io, amortizationMonths: amortization });
    const paymentMinor = draft.payment == null ? levelPi : minorOf(draft.payment);
    if (paymentMinor == null || paymentMinor <= 0n || paymentMinor > SAFE_MINOR) return { status: "empty" };
    const schedule = buildLoanSchedule({
      principalMinor,
      annualRatePpm: ratePpm,
      termMonths,
      startDate: draft.startDate,
      paymentMinor,
      escrowMinor,
      kind,
      interestOnlyMonths: io,
      amortizationMonths: amortization,
    });
    const interestMinor = schedule.rows.reduce((sum, row) => sum + row.interestMinor, 0n);
    const name = draft.name.trim();
    return {
      status: "ready",
      kind,
      paymentMinor,
      interestMinor,
      escrowMinor,
      balloon: schedule.balloon,
      finalAdjustment: schedule.finalAdjustment,
      largeFinalMinor: largeFinal(schedule, paymentMinor, escrowMinor),
      insert: {
        name,
        principal_minor: Number(principalMinor),
        annual_rate_ppm: ratePpm,
        term_months: termMonths,
        start_date: draft.startDate,
        payment_minor: Number(paymentMinor),
        escrow_minor: Number(escrowMinor),
        currency: draft.currency,
        kind,
        interest_only_months: io,
        amortization_months: amortization,
      },
    };
  } catch (error) {
    if (error instanceof LoanScheduleError) return { status: "error", code: error.code };
    throw error;
  }
}

type AmountState = "empty" | "minus" | "zero" | "large" | bigint;

function amountState(text: string): AmountState {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.endsWith(".")) return trimmed.startsWith("-") ? "minus" : "empty";
  if (trimmed.startsWith("-")) return "minus";
  try {
    const minor = parseDecimalHalfEven(trimmed.replace(/[\s,]/g, ""), 2);
    if (minor < 0n) return "minus";
    if (minor === 0n) return "zero";
    if (minor > SAFE_MINOR) return "large";
    return minor;
  } catch {
    return "empty";
  }
}

/**
 * Floor the ratio to tenths. Half-even would turn 2.95 into 3 and 2.02 into 2.
 * Anything above twice and below 2.1 stays 2.1, so the line never reads פי 2.
 */
function timesAboveTwice(finalPi: bigint, pi: bigint): string {
  let tenths = (finalPi * 10n) / pi;
  if (tenths < 21n) tenths = 21n;
  const whole = tenths / 10n;
  const frac = tenths % 10n;
  return frac === 0n ? whole.toString() : `${whole.toString()}.${frac.toString()}`;
}

/** One line for the final payment. A 2× warning replaces the adjusted line. */
export function loanFinalLine(preview: Extract<LoanPreview, { status: "ready" }>): LoanFinalLine | null {
  if (preview.balloon) {
    const lead = preview.kind === "balloon" ? "בלון בסוף התקופה" : "התשלום האחרון גבוה יותר";
    return { tone: "plain", lead, amountMinor: preview.balloon.amountMinor };
  }
  const pi = preview.paymentMinor - preview.escrowMinor;
  if (preview.largeFinalMinor != null && pi > 0n) {
    const finalPi = preview.largeFinalMinor - preview.escrowMinor;
    if (finalPi === pi * 2n) {
      return { tone: "caution", lead: "התשלום האחרון כפול", amountMinor: preview.largeFinalMinor };
    }
    if (finalPi > pi * 2n) {
      return {
        tone: "caution",
        lead: "התשלום האחרון גבוה פי",
        times: timesAboveTwice(finalPi, pi),
        amountMinor: preview.largeFinalMinor,
      };
    }
  }
  if (preview.finalAdjustment) {
    return { tone: "plain", lead: "תשלום אחרון מותאם", amountMinor: preview.finalAdjustment.amountMinor };
  }
  return null;
}

/** Every blocking field at once. An incomplete rate or amount is not an error. */
export function loanFieldErrors(draft: LoanDraft, preview: LoanPreview): LoanFieldErrors {
  const errors: LoanFieldErrors = {};
  if (draft.name.trim() === "") errors.name = "כתבו את שם המלווה.";

  const principal = amountState(draft.principal);
  if (principal === "empty") errors.principal = "כתבו את הסכום המקורי.";
  // FLOW-115: each message says what to type; a 0 is not a missing amount.
  if (principal === "minus") errors.principal = MINUS;
  else if (principal === "zero") errors.principal = "הסכום צריך להיות גדול מ־0.";
  else if (principal === "large") errors.principal = TOO_LARGE;

  const rate = draft.rate.trim();
  if (rate === "") errors.rate = "כתבו את הריבית השנתית.";
  else if (rate.startsWith("-")) errors.rate = "כתבו ריבית בלי מינוס.";
  else if (rate !== "" && !rate.endsWith(".") && ratePpmOf(rate) == null) errors.rate = RATE_RANGE;

  // A demand loan has no term, escrow or payment (FLOW-106 §3.3).
  if (draft.kind === "demand") return errors;

  if (draft.term.trim() === "") errors.term = "כתבו את מספר החודשים.";
  else if (draft.term.startsWith("-") || termOf(draft.term) == null) errors.term = TERM_RANGE;

  const term = termOf(draft.term);
  const months = monthsOf(draft.kindMonths);
  if (draft.kind === "interest_only" && (months == null || months < 1 || (term != null && months > term))) {
    errors.months = term == null ? "כתבו את מספר חודשי הריבית בלבד." : `כתבו בין 1 ל־${String(term)} חודשים.`;
  }
  if (draft.kind === "balloon" && (months == null || months > LOAN_TERM_MONTHS_MAX || (term != null && months < term))) {
    errors.months = `כתבו בין ${String(term ?? 1)} ל־${String(LOAN_TERM_MONTHS_MAX)} חודשים.`;
  }

  const escrowText = draft.escrow.trim() === "" ? "0" : draft.escrow;
  const escrow = amountState(escrowText);
  if (escrow === "minus") errors.escrow = MINUS;
  else if (escrow === "large") errors.escrow = TOO_LARGE;

  const payment = draft.payment == null || draft.payment === "" ? "empty" : amountState(draft.payment);
  if (payment === "minus") errors.payment = MINUS;
  else if (payment === "large") errors.payment = TOO_LARGE;

  const escrowCoversPayment = typeof escrow === "bigint" && typeof payment === "bigint" && escrow >= payment;
  if (errors.escrow == null && (escrowCoversPayment || (preview.status === "error" && preview.code === "escrow"))) {
    errors.escrow = "המסים והביטוח צריכים להיות נמוכים מהתשלום.";
  }
  if (errors.payment == null && preview.status === "error" && preview.code === "payment_below_interest") {
    errors.payment = BELOW_INTEREST;
  }
  return errors;
}

const MINUS = "כתבו סכום בלי מינוס.";
const TOO_LARGE = "כתבו סכום קטן יותר.";
const RATE_RANGE = "כתבו ריבית עד 100%.";
const TERM_RANGE = "כתבו בין 1 ל־600 חודשים.";
const BELOW_INTEREST = "התשלום צריך להיות גבוה מהריבית החודשית.";

export function loanErrorText(code: string): string {
  if (code === "payment_below_interest") return BELOW_INTEREST;
  if (code === "rate") return RATE_RANGE;
  if (code === "term") return TERM_RANGE;
  if (code === "start_date") return "תאריך לא תקין.";
  return "לא ניתן לחשב את לוח הסילוקין.";
}

/** The loan form's default: the stored company currency. A failure stays shekels. */
export async function readCompanyLoanCurrency(): Promise<LoanCurrency> {
  return companyLoanCurrency(await readCompanyCurrency());
}
