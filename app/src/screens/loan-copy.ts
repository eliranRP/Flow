import type { LoanKind, LoanSplitPart, LoanStatus } from "@flow/shared";
import { formatDisplay } from "../ui/date-math";
import { isTransientWriteError, type WriteFailure } from "../use-write";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";

/**
 * FLOW-106 screens plan §5: Hebrew for every loan refusal. The client guards what it can; a
 * server reply maps to the same text. Codes come from the loan triggers (`loan_*`), the
 * table checks, save_loan_split, delete_loan and restore_loan.
 */

export const LOAN_KIND_LABEL: Record<LoanKind, string> = {
  amortizing: "רגילה",
  interest_only: "ריבית בלבד",
  balloon: "בלון",
  demand: "לפי דרישה",
};

export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  open: "פתוחה",
  paid_off: "נפרעה",
  closed: "נסגרה",
};

export const LOAN_PART_LABEL: Record<LoanSplitPart, string> = {
  interest: "ריבית",
  escrow: "מסים וביטוח",
  principal: "קרן",
  fees: "עמלות",
};

/** Where a refusal shows. A sheet keeps its own line; the rest go to a toast. */
export type LoanRefusalPlace = "toast" | "status" | "category" | "kind" | "rate" | "editor";

export type LoanCopyContext = {
  currency?: LoanCurrency;
  /** The loan's closed_on, for loan_closed. */
  closedOn?: string | null;
  /** The loan's start, for a rate before it. */
  startDate?: string | null;
  /** The merge target's name, for the merge refusal. */
  target?: string;
  lineMinor?: bigint;
  missingMinor?: bigint;
  overMinor?: bigint;
};

/**
 * Each reason a loan write can be refused, as the server raises it. A reason from a trigger and
 * its MCP spelling share one copy. loan-copy.test.ts checks this list against the migrations.
 */
export const LOAN_REFUSALS = [
  "loan_closed",
  "loan closed",
  "a loan uses this category for a part the other category cannot take",
  "loan category is fixed",
  "loan_payments_after_close",
  "payments after closed_on",
  "loan_category_not_allowed",
  "loan_split_category",
  "category does not fit the loan part",
  "loan_payment_below_interest",
  "payment below interest",
  "loans_kind_chk",
  "loans_closed_chk",
  "closed_on required",
  "loan_split_incomplete",
  "loan_split_sum",
  "invalid loan parts",
  "loan_split_balance",
  "loan_split_over_balance",
  "loan balance exceeded",
  "fees category required",
  "payment before the loan start",
  "a later payment is already attached",
  "rate before the loan start",
  "loan_split_currency",
  "loan currency mismatch",
  "loan already attached",
  "loan not found",
  "loan cannot be restored",
  "transaction not found",
  "category not found",
  "loan categories missing",
  "loan_split_income",
  "invalid loan terms",
  "project not found",
  "line has a loan split",
  "loan line is fixed",
  "loan is open",
  "forbidden",
  "no company",
  "validation",
] as const;

export type LoanRefusal = (typeof LOAN_REFUSALS)[number];

function money(minor: bigint, currency: LoanCurrency | undefined): string {
  return formatLoanMoney(minor, currency ?? "ILS");
}

/** The Hebrew for one refusal reason. */
export function loanRefusalText(reason: LoanRefusal, ctx: LoanCopyContext = {}): string {
  switch (reason) {
    case "loan_closed":
    case "loan closed":
      return ctx.closedOn
        ? `ההלוואה נסגרה ב־${formatDisplay(ctx.closedOn)}. אפשר לשייך רק תשלומים עד התאריך הזה.`
        : "ההלוואה נסגרה. אפשר לשייך רק תשלומים עד תאריך הסגירה.";
    case "a loan uses this category for a part the other category cannot take":
      return ctx.target
        ? `הלוואה משתמשת בקטגוריה הזו, ו־${ctx.target} לא מתאימה לאותו חלק. החליפו קודם את הקטגוריה בהלוואה.`
        : "הלוואה משתמשת בקטגוריה הזו, והקטגוריה שנבחרה לא מתאימה לאותו חלק. החליפו קודם את הקטגוריה בהלוואה.";
    case "loan category is fixed":
      return "הלוואה משתמשת בקטגוריה הזו. כדי להעביר אותה, החליפו קודם את הקטגוריה בהלוואה.";
    case "loan_payments_after_close":
    case "payments after closed_on":
      return "יש תשלום משויך אחרי התאריך הזה. בחרו תאריך מאוחר יותר.";
    case "loan_category_not_allowed":
    case "loan_split_category":
    case "category does not fit the loan part":
      return "הקטגוריה לא מתאימה לחלק הזה.";
    case "loan_payment_below_interest":
    case "payment below interest":
      return "התשלום לא מכסה את הריבית החודשית.";
    case "loans_kind_chk":
      return "חסר פרט לסוג ההלוואה הזה.";
    case "loans_closed_chk":
    case "closed_on required":
      return "חסר תאריך סגירה.";
    case "loan_split_incomplete":
      return "חסר חלק בפיצול. עמלות צריכות להיות מעל 0.";
    case "loan_split_sum":
    case "invalid loan parts":
      if (ctx.overMinor != null && ctx.overMinor > 0n) return `עוברים את השורה ב־${money(ctx.overMinor, ctx.currency)}.`;
      if (ctx.lineMinor != null && ctx.missingMinor != null && ctx.missingMinor > 0n) {
        return `החלקים צריכים להסתכם ב־${money(ctx.lineMinor, ctx.currency)}. חסרים ${money(ctx.missingMinor, ctx.currency)}.`;
      }
      return "החלקים צריכים להסתכם בסכום השורה.";
    case "loan_split_balance":
    case "loan_split_over_balance":
    case "loan balance exceeded":
      return "התשלום גבוה מיתרת ההלוואה.";
    case "fees category required":
      return "בחרו לאן נרשמות העמלות.";
    case "payment before the loan start":
      return "לפני תחילת ההלוואה";
    case "a later payment is already attached":
      return "יש תשלום מאוחר יותר משויך. שייכו לפי סדר התאריכים.";
    case "rate before the loan start":
      return ctx.startDate
        ? `התאריך לפני תחילת ההלוואה (${formatDisplay(ctx.startDate)}).`
        : "התאריך לפני תחילת ההלוואה.";
    case "loan_split_currency":
    case "loan currency mismatch":
      return "המטבע של השורה לא מתאים להלוואה.";
    case "loan already attached":
      return "התשלום כבר שויך להלוואה אחרת.";
    case "loan not found":
      return "ההלוואה לא נמצאה.";
    case "loan cannot be restored":
      return "אי אפשר להחזיר את ההלוואה: אחד התשלומים השתנה מאז.";
    case "transaction not found":
      return "התנועה לא נמצאה.";
    case "category not found":
      return "הקטגוריה לא נמצאה.";
    case "loan categories missing":
      return "חסרות קטגוריות להלוואה.";
    case "loan_split_income":
      return "אי אפשר לשייך הכנסה להלוואה.";
    case "invalid loan terms":
      return "פרטי ההלוואה לא תקינים.";
    case "project not found":
      return "הפרויקט לא נמצא.";
    case "line has a loan split":
    case "loan line is fixed":
      return "השורה משויכת להלוואה. משנים אותה מתוך הפיצול של ההלוואה.";
    case "loan is open":
      return "להלוואה פתוחה אין תאריך סגירה.";
    case "forbidden":
      return "אין הרשאה לעדכן הלוואה.";
    case "no company":
      return "אין עסק עדיין.";
    case "validation":
      return "השינוי לא נשמר";
  }
}

/** Where each refusal shows (plan §5). Anything not named here is a toast. */
export function loanRefusalPlace(reason: LoanRefusal): LoanRefusalPlace {
  switch (reason) {
    case "loan_payments_after_close":
    case "payments after closed_on":
    case "loans_closed_chk":
    case "closed_on required":
    case "loan is open":
      return "status";
    case "loan_category_not_allowed":
    case "category does not fit the loan part":
      return "category";
    case "loan_payment_below_interest":
    case "payment below interest":
    case "loans_kind_chk":
      return "kind";
    case "rate before the loan start":
      return "rate";
    case "loan_split_category":
    case "loan_split_incomplete":
    case "loan_split_sum":
    case "invalid loan parts":
    case "fees category required":
      return "editor";
    default:
      return "toast";
  }
}

/** The refusal an error carries, by its message (a trigger name, a check name, or a raise). */
export function loanRefusalOf(error: Error): LoanRefusal | null {
  const code = (error as { code?: string }).code;
  if (code === "42501") return "forbidden";
  // The loan's project was deleted meanwhile (loans.project_id foreign key).
  if (code === "23503") return "project not found";
  const message = error.message;
  // Longer reasons first, so "loan closed" does not catch "loan_closed_chk" and the like.
  const ordered = [...LOAN_REFUSALS].sort((a, b) => b.length - a.length);
  for (const reason of ordered) {
    if (reason === "validation" || reason === "forbidden") continue;
    if (message.includes(reason)) return reason;
  }
  if (message === "validation") return "validation";
  if (message === "forbidden") return "forbidden";
  return null;
}

export const LOAN_WRITE_FAILED = "השינוי לא נשמר";

/** A loan write's toast: the refusal's Hebrew, else "השינוי לא נשמר" with ניסיון חוזר. */
export function loanFailure(error: Error, ctx: LoanCopyContext = {}): WriteFailure {
  const reason = loanRefusalOf(error);
  if (reason != null && reason !== "validation") return { message: loanRefusalText(reason, ctx), retry: false };
  return { message: LOAN_WRITE_FAILED, retry: reason == null || isTransientWriteError(error) };
}

/** The confirm line for a delete: how many matched payments count whole again (decision 0142). */
export function loanDeleteConsequence(payments: number): string {
  if (payments <= 0) return "אין תשלומים משויכים. שינויי הריבית יימחקו איתה.";
  if (payments === 1) return "תשלום אחד יחזור לקטגוריה שלו.";
  return `${String(payments)} תשלומים יחזרו לקטגוריה שלהם.`;
}

/** The toast after a delete. */
export function loanDeletedToast(name: string): string {
  return `${name} נמחקה`;
}

/** "N חלקים" for a payment row: 3, or 4 with fees. */
export function loanPartsText(parts: number): string {
  return parts === 1 ? "חלק אחד" : `${String(parts)} חלקים`;
}
