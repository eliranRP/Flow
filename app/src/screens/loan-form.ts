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
import { assertNoError } from "../use-write";

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
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${sign}${LOAN_CURRENCY_MARK[currency]}${whole}.${frac}`;
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
       * Set when the final principal-and-interest is more than twice the regular
       * one, and the loan is not a balloon. Escrow is left out of both sides.
       */
      largeFinalMinor: bigint | null;
      insert: Omit<LoanInsert, "company_id">;
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
  if (finalPi <= pi * 2n) return null;
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
 */
export async function readCompanyLoanCurrency(): Promise<LoanCurrency> {
  const supabase = getSupabase();
  if (!supabase) return "ILS";
  const other = await supabase
    .from("transactions")
    .select("id")
    .is("removed_at", null)
    .neq("currency", "USD")
    .limit(1);
  assertNoError(other);
  if ((other.data ?? []).length > 0) return "ILS";
  const usd = await supabase
    .from("transactions")
    .select("id")
    .is("removed_at", null)
    .eq("currency", "USD")
    .limit(1);
  assertNoError(usd);
  if ((usd.data ?? []).length > 0) return "USD";
  return "ILS";
}
