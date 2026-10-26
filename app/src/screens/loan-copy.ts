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
  amortizing: "פריסה רגילה",
  interest_only: "ריבית בלבד",
  balloon: "בלון",
  demand: "לפי דרישה",
};

/** The kind word under a row on the Loans tab (board: short words; the detail page keeps LOAN_KIND_LABEL). */
export const LOAN_KIND_LIST_LABEL: Record<LoanKind, string> = {
  amortizing: "פריסה רגילה",
  interest_only: "ריבית בלבד",
  balloon: "בלון",
  demand: "לפי דרישה",
};

export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  open: "פעילה",
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

/** The confirm line for a delete: what goes, and how many matched payments count whole again (decision 0142). */
export function loanDeleteConsequence(payments: number): string {
  const lost = "לוח התשלומים, הצפי ושינויי הריבית שלה יימחקו.";
  if (payments <= 0) return `${lost} אין לה תשלומים משויכים.`;
  if (payments === 1) return `${lost} התשלום שכבר שויך יישאר בתנועות ויחזור לקטגוריה שלו.`;
  return `${lost} ${String(payments)} התשלומים שכבר שויכו יישארו בתנועות ויחזרו לקטגוריה שלהם.`;
}

/** FLOW-962: why a loan closed before its term. paid_off is נפרעה במלואה, closed is מימון מחדש. */
export type LoanCloseReason = Exclude<LoanStatus, "open">;

export const LOAN_CLOSE_REASON: Record<LoanCloseReason, string> = {
  paid_off: "נפרעה במלואה",
  closed: "מימון מחדש",
};

export const LOAN_CLOSE_REASON_HINT: Record<LoanCloseReason, string> = {
  paid_off: "שילמתם את כל היתרה לפני סוף התקופה",
  closed: "הלוואה חדשה החליפה את זו",
};

/**
 * FLOW-962: the line under "מתי השינוי חל?". Payments already attached keep their parts (decision
 * 0132), so a past day says how many there are since then and that they stay as they are.
 */
export function rateChangeLine(day: string, today: string, since: number, nextDue: string | null): string {
  const kept = "תשלומים קודמים לא משתנים.";
  if (day > today) return `מ־${formatDisplay(day)} החישוב לפי הריבית החדשה. ${kept}`;
  if (day < today && since > 0) {
    const count = since === 1 ? "תשלום אחד שויך" : `${String(since)} תשלומים שויכו`;
    return `${count} מאז ${formatDisplay(day)}, והם נשארים כפי שהם. התאריך קובע רק ממתי הלוח והצפי לפי הריבית החדשה.`;
  }
  if (nextDue == null) return `מ־${formatDisplay(day)} החישוב לפי הריבית החדשה. ${kept}`;
  return `התשלום הבא, ${nextDue.slice(8, 10)}/${nextDue.slice(5, 7)}, יחושב לפי הריבית החדשה. ${kept}`;
}

/** The line under a closed loan's head. */
export const LOAN_CLOSED_NOTE: Record<LoanCloseReason, string> = {
  paid_off: "שולמה במלואה. היא לא בצפי ולא בסך החוב.",
  closed: "מומנה מחדש בהלוואה אחרת. היא לא בצפי ולא בסך החוב.",
};

/** The line above סגירת ההלוואה: where the loan goes and what leaves the forecast. */
export function loanCloseLine(reason: LoanCloseReason, nextDue: string | null): string {
  const forecast = nextDue == null ? "" : ` התשלומים מ־${nextDue.slice(8, 10)}/${nextDue.slice(5, 7)} יורדו מהצפי.`;
  if (reason === "closed") return `תעבור לנסגרו.${forecast} את ההלוואה החדשה מוסיפים כהלוואה משלה.`;
  return `תעבור לנסגרו.${forecast} תשלום הפירעון יישאר בתנועות.`;
}

/** "נסגרה · מימון מחדש · 26/10/2026": the head of a closed loan's page. */
export function loanClosedLine(status: LoanCloseReason, closedOn: string | null): string {
  return ["נסגרה", LOAN_CLOSE_REASON[status], closedOn == null ? null : formatDisplay(closedOn)]
    .filter((part): part is string => part != null)
    .join(" · ");
}

/** The toast after a close. A paid-off loan with a balance left says so (0122 allows it). */
export function loanClosedToast(name: string, status: LoanCloseReason, balanceMinor: bigint, currency: LoanCurrency): string {
  const left = status === "paid_off" && balanceMinor > 0n ? ` · נשארה יתרה ${formatLoanMoney(balanceMinor, currency)} בספרים` : "";
  return `${name} נסגרה · ${LOAN_CLOSE_REASON[status]}${left}`;
}

/** The toast after a delete. */
export function loanDeletedToast(name: string): string {
  return `${name} נמחקה`;
}
