import {
  buildLoanSchedule,
  contractualPaymentMinor,
  LOAN_TERM_MONTHS_MAX,
  LoanScheduleError,
  parseDecimalHalfEven,
  type LoanBalloon,
  type LoanFinalAdjustment,
  type LoanSchedule,
} from "@flow/shared";
import { israelToday } from "../ui/date-math";
import { getSupabase } from "../lib/supabase";

export type LoanCurrency = "ILS" | "USD";

export const LOAN_CURRENCY_MARK: Record<LoanCurrency, string> = {
  ILS: "₪",
  USD: "$",
};

const SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Dollars only when every open line is USD.
 * Shekels for a mix, another currency, or a company with no lines yet.
 * `companies.display_currency` is not in the schema, so this is the stand-in.
 */
export function companyLoanCurrency(currencies: readonly string[]): LoanCurrency {
  if (currencies.length === 0) return "ILS";
  for (const currency of currencies) {
    if (currency !== "USD") return "ILS";
  }
  return "USD";
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
};

export type LoanInsert = {
  company_id: string;
  name: string;
  principal_minor: number;
  annual_rate_ppm: number;
  term_months: number;
  start_date: string;
  payment_minor: number;
  escrow_minor: number;
  currency: LoanCurrency;
};

export type LoanPreview =
  | { status: "empty" }
  | { status: "error"; code: string }
  | {
      status: "ready";
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

export type LoanField = "name" | "principal" | "rate" | "term" | "escrow" | "payment";

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

export function loanPreview(draft: LoanDraft): LoanPreview {
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

  try {
    const levelPi = contractualPaymentMinor({ principalMinor, annualRatePpm: ratePpm, termMonths });
    const paymentMinor = draft.payment == null ? levelPi + escrowMinor : minorOf(draft.payment);
    if (paymentMinor == null || paymentMinor <= 0n || paymentMinor > SAFE_MINOR) return { status: "empty" };
    const schedule = buildLoanSchedule({
      principalMinor,
      annualRatePpm: ratePpm,
      termMonths,
      startDate: draft.startDate,
      paymentMinor,
      escrowMinor,
    });
    const interestMinor = schedule.rows.reduce((sum, row) => sum + row.interestMinor, 0n);
    const name = draft.name.trim();
    return {
      status: "ready",
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
    return { tone: "plain", lead: "התשלום האחרון גבוה יותר", amountMinor: preview.balloon.amountMinor };
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
  if (draft.name.trim() === "") errors.name = "חסר מלווה.";

  const principal = amountState(draft.principal);
  if (principal === "minus") errors.principal = "הסכום שלילי.";
  else if (principal === "zero") errors.principal = "חסר סכום.";
  else if (principal === "large") errors.principal = "הסכום גדול מדי.";

  const rate = draft.rate.trim();
  if (rate.startsWith("-")) errors.rate = "הריבית שלילית.";
  else if (rate !== "" && !rate.endsWith(".") && ratePpmOf(rate) == null) errors.rate = "הריבית היא עד 100%.";

  if (draft.term.trim() === "") errors.term = "חסרה תקופה.";
  else if (draft.term.startsWith("-") || termOf(draft.term) == null) errors.term = "התקופה היא בין חודש אחד ל־600.";

  const escrowText = draft.escrow.trim() === "" ? "0" : draft.escrow;
  const escrow = amountState(escrowText);
  if (escrow === "minus") errors.escrow = "הסכום שלילי.";
  else if (escrow === "large") errors.escrow = "הסכום גדול מדי.";

  const payment = draft.payment == null || draft.payment === "" ? "empty" : amountState(draft.payment);
  if (payment === "minus") errors.payment = "הסכום שלילי.";
  else if (payment === "large") errors.payment = "הסכום גדול מדי.";

  const escrowCoversPayment = typeof escrow === "bigint" && typeof payment === "bigint" && escrow >= payment;
  if (errors.escrow == null && (escrowCoversPayment || (preview.status === "error" && preview.code === "escrow"))) {
    errors.escrow = "המסים והביטוח גבוהים מהתשלום.";
  }
  if (errors.payment == null && preview.status === "error" && preview.code === "payment_below_interest") {
    errors.payment = "התשלום לא מכסה את הריבית.";
  }
  return errors;
}

export function loanErrorText(code: string): string {
  if (code === "payment_below_interest") return "התשלום לא מכסה את הריבית.";
  if (code === "rate") return "הריבית היא עד 100%.";
  if (code === "term") return "התקופה היא בין חודש אחד ל־600.";
  if (code === "start_date") return "תאריך לא תקין.";
  return "לא ניתן לחשב את לוח הסילוקין.";
}

/**
 * Open lines only. One non-USD line keeps shekels.
 * A failure stays shekels: the books are shekels until display currency exists.
 * TODO(display_currency): read companies.display_currency instead of inferring it from open lines.
 */
export async function readCompanyLoanCurrency(): Promise<LoanCurrency> {
  const supabase = getSupabase();
  if (!supabase) return "ILS";
  // The newest 1000 open lines. mcp_company_loan_currency reads the same set.
  const lines = await supabase
    .from("transactions")
    .select("currency")
    .is("removed_at", null)
    .order("doc_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1000);
  if (lines.error) return "ILS";
  return companyLoanCurrency(lines.data.map((row) => row.currency));
}
