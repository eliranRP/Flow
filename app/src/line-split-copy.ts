import { formatAmountText } from "@flow/shared";
import type { LocalIssue } from "./line-split";
import type { WriteFailure } from "./use-write";

/**
 * FLOW-325. Every message `save_line_split` raises (20261008150000_line_split_review.sql,
 * after #142's 20261008140000_line_split_preview.sql). The copy test reads the migration and
 * fails when a new message has no Hebrew here.
 */
export const LINE_SPLIT_REFUSALS = [
  "no company",
  "validation",
  "transaction not found",
  "line amount is zero",
  "line has a loan split",
  "line has an open review",
  "line has no category for the rest",
  "same category and project twice",
  "category not found",
  "a reversal part needs a project",
  "project not found",
  "parts exceed the line",
  "a part rounds to zero",
  "parts must sum to the line",
  "nothing is left for the rest",
] as const;

export type LineSplitRefusal = (typeof LINE_SPLIT_REFUSALS)[number];

/** Where a reason shows: under a part, on the rest row, as a banner, or in the footer. */
export type RefusalPlace = "part" | "rest" | "banner" | "footer";

export const LINE_SPLIT_PLACE: Record<LineSplitRefusal, RefusalPlace> = {
  "no company": "banner",
  validation: "footer",
  "transaction not found": "banner",
  "line amount is zero": "banner",
  "line has a loan split": "banner",
  "line has an open review": "banner",
  "line has no category for the rest": "rest",
  "same category and project twice": "part",
  "category not found": "banner",
  "a reversal part needs a project": "part",
  "project not found": "banner",
  "parts exceed the line": "footer",
  "a part rounds to zero": "part",
  "parts must sum to the line": "footer",
  "nothing is left for the rest": "rest",
};

export const LINE_SPLIT_SAVE_FAILURE = "הפיצול לא נשמר";
export const LINE_SPLIT_CHANGED = "משהו השתנה בינתיים. טענו מחדש ונסו שוב.";
/**
 * The project split (`SplitScreen`) on a line that has a split by category: the detail row's
 * reason hint, and the copy for the refusal "line has a split by category".
 */
export const LINE_HAS_CATEGORY_SPLIT = "לשורה יש פיצול לפי קטגוריות. אפשר רק אחד מהשניים.";
export const LINE_HAS_CATEGORY_SPLIT_REASON = "line has a split by category";
export const LINE_SPLIT_PARTS_CHANGED = "סכום השורה השתנה מאז הפיצול. השורה נספרת כולה עד שתעדכנו.";

function money(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency, { detail: true });
}

/** Hebrew for a server reason. `overMinor` and `missingMinor` fill the amounts when known. */
export function lineSplitCopy(
  reason: LineSplitRefusal,
  ctx: { currency?: string; overMinor?: bigint; lineMinor?: bigint; missingMinor?: bigint } = {},
): string {
  const currency = ctx.currency ?? "ILS";
  switch (reason) {
    case "parts exceed the line":
      return ctx.overMinor != null && ctx.overMinor > 0n
        ? `החלקים עוברים את השורה ב־${money(ctx.overMinor, currency)}. הקטינו חלק.`
        : "החלקים עוברים את השורה. הקטינו חלק.";
    case "a part rounds to zero":
      return `האחוז קטן מדי – יוצא ${money(0n, currency)}.`;
    case "nothing is left for the rest":
      return "לא נשאר סכום לשאר. הוסיפו חלק או הקטינו את החלק.";
    case "line has no category for the rest":
      return "לשורה אין קטגוריה. בחרו קטגוריה לשאר.";
    case "a reversal part needs a project":
      return "חלק החזר צריך פרויקט.";
    case "parts must sum to the line":
      return ctx.lineMinor != null && ctx.missingMinor != null
        ? `החלקים צריכים להסתכם ב־${money(ctx.lineMinor, currency)}. חסרים ${money(ctx.missingMinor, currency)}.`
        : "החלקים צריכים להסתכם בסכום השורה.";
    case "line has a loan split":
      return "לשורה יש פיצול הלוואה. אפשר רק אחד מהשניים.";
    case "line has an open review":
      return "אשרו את התנועה בתור לאישור, ואז פצלו.";
    case "same category and project twice":
      return "הקטגוריה והפרויקט האלה כבר בחלק אחר.";
    case "line amount is zero":
      return "סכום השורה אפס. אין מה לפצל.";
    case "transaction not found":
    case "category not found":
    case "project not found":
      return LINE_SPLIT_CHANGED;
    case "no company":
    case "validation":
      return "לא נשמר. בדקו את הפרטים ונסו שוב.";
  }
}

/** The client checks, in the same voice. */
export function localIssueCopy(issue: LocalIssue, ctx: { currency?: string; overMinor?: bigint } = {}): string {
  switch (issue) {
    case "incomplete":
      return "השלימו קטגוריה וסכום לכל חלק.";
    case "percent over":
      return "עד 100%";
    case "too few parts":
      return "פיצול צריך לפחות שני חלקים.";
    case "a reversal part needs a project":
      return "בחרו פרויקט לחלק ההחזר.";
    case "same category and project twice":
    case "parts exceed the line":
      return lineSplitCopy(issue, ctx);
  }
}

/** The named reason in a PostgREST error, or null for a network failure or anything else. */
export function lineSplitRefusal(error: unknown): LineSplitRefusal | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  // Longer reasons first, so "validation" never shadows a named one.
  const named = [...LINE_SPLIT_REFUSALS].sort((a, b) => b.length - a.length);
  return named.find((reason) => message.includes(reason)) ?? null;
}

/** FLOW-325: the two split kinds exclude each other; the server refuses a project split on a line split by category. */
export function hasCategorySplit(error: unknown): boolean {
  return error instanceof Error && error.message.includes(LINE_HAS_CATEGORY_SPLIT_REASON);
}

/** The project split's save failure: that refusal is final and says why, anything else is the usual copy. */
export function projectSplitFailure(error: Error): WriteFailure {
  return hasCategorySplit(error) ? { message: LINE_HAS_CATEGORY_SPLIT, retry: false } : "הפיצול לא נשמר";
}
