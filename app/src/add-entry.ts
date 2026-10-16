// FLOW-369: the add sheet's form rules, kept out of the components so they can be tested as plain
// functions. Amounts are whole minor units (agorot for ILS); dates are yyyy-mm-dd in the database
// and dd/mm/yyyy on the form.

/** The "בלי פרויקט" chip: the line is filed as overhead (no project). */
export const NO_PROJECT = "none";

export type EntryDirection = "out" | "in";
export type EntryMethod = "cash" | "cheque";
/** receipt: a document was attached from the camera or a file. cash: no document. */
export type EntryKind = "receipt" | "cash";

export interface EntryDraft {
  direction: EntryDirection;
  amount: string;
  payee: string;
  date: string;
  method: EntryMethod;
  cheque: string;
  /** A project id, NO_PROJECT, or null while nothing is chosen. */
  projectId: string | null;
  /** A category id, or null while nothing is chosen. */
  categoryId: string | null;
}

/** The form as it opens: an expense, nothing typed, today, and the project it was opened from. */
export function emptyDraft(projectId: string | null, today: string): EntryDraft {
  return {
    direction: "out",
    amount: "",
    payee: "",
    date: today,
    method: "cash",
    cheque: "",
    projectId,
    categoryId: null,
  };
}

/** A bank line a receipt matches (the receipt_match RPC). */
export interface BankMatch {
  id: string;
  description: string;
  doc_date: string;
  amount_minor: number;
  source: string;
}

/** A document chosen on the phone. No file is read: the name, type and size are kept. */
export interface AttachedDocument {
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
}

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
const DISPLAY_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const CHEQUE = /^[0-9A-Za-z-]{1,20}$/;
/** Control characters, line and paragraph separators, and the invisible format characters a pasted name can carry. */
const HIDDEN = /[\p{Cc}\p{Zl}\p{Zp}\p{Cf}]/u;
const ZWJ = /‍/g;

/** "409.01" or "2,400" → agorot (40901, 240000). Null when empty, zero, or not an amount. */
export function parseAmountMinor(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (!AMOUNT.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return minor > 0 ? minor : null;
}

/** A calendar day from dd/mm/yyyy, as yyyy-mm-dd. Null for anything that is not a real day. */
export function parseDisplayDate(text: string): string | null {
  const match = DISPLAY_DATE.exec(text.trim());
  if (match == null) return null;
  const [, dd = "", mm = "", yyyy = ""] = match;
  const iso = `${yyyy}-${mm}-${dd}`;
  const time = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** The day shown by default: today in the phone's time zone, as dd/mm/yyyy. */
export function todayDisplayDate(now: Date = new Date()): string {
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${String(now.getFullYear())}`;
}

/** A payee the server accepts: 2 to 120 characters, no hidden character. */
export function payeeProblem(payee: string): "short" | "hidden" | null {
  const name = payee.trim();
  if (HIDDEN.test(name.replace(ZWJ, ""))) return "hidden";
  if (Array.from(name).length < 2 || Array.from(name).length > 120) return "short";
  return null;
}

/** A new project or category name: at least two characters, no hidden character, not already on the list. */
export function newNameProblem(name: string, existing: readonly string[]): "short" | "hidden" | "duplicate" | null {
  const trimmed = name.trim();
  if (HIDDEN.test(trimmed.replace(ZWJ, ""))) return "hidden";
  if (Array.from(trimmed).length < 2) return "short";
  if (existing.some((item) => item.trim().toLowerCase() === trimmed.toLowerCase())) return "duplicate";
  return null;
}

/** The cheque number the server accepts: 1 to 20 letters, digits or hyphens. */
export function chequeProblem(cheque: string): boolean {
  return !CHEQUE.test(cheque.trim());
}

/**
 * The form's save rule: the amount, the payee, the project and the category are set (the date and a
 * cheque's number too). Save is disabled until this is true.
 */
export function isEntryReady(draft: EntryDraft): boolean {
  if (parseAmountMinor(draft.amount) == null) return false;
  if (payeeProblem(draft.payee) != null) return false;
  if (draft.projectId == null || draft.categoryId == null) return false;
  if (parseDisplayDate(draft.date) == null) return false;
  if (draft.method === "cheque" && chequeProblem(draft.cheque)) return false;
  return true;
}

/**
 * What saving does. A receipt that matches a bank line attaches to that line and adds none. Any
 * other save makes one line, and a receipt's document is attached to it.
 */
export type SavePlan =
  | { kind: "attach"; transactionId: string }
  | { kind: "create"; attachDocument: boolean };

export function planSave(kind: EntryKind, match: BankMatch | null | undefined, hasDocument: boolean): SavePlan {
  if (kind === "receipt" && match != null) return { kind: "attach", transactionId: match.id };
  return { kind: "create", attachDocument: kind === "receipt" && hasDocument };
}

/** The bank line's words in the match box: payee · −amount · dd/mm · source. */
export function matchLine(match: BankMatch, formatMoney: (minor: number) => string): string {
  const day = match.doc_date.slice(8, 10);
  const month = match.doc_date.slice(5, 7);
  return `${match.description} · −${formatMoney(match.amount_minor)} · ${day}/${month} · ${SOURCE_LABEL[match.source] ?? ""}`.replace(/ · $/, "");
}

const SOURCE_LABEL: Record<string, string> = {
  sumit: "SUMIT",
  mercury: "Mercury",
  hapoalim: "הפועלים",
  photo: "צילום",
};

/** Puts the chips named in `last` at the end, in their order, after the others (בלי פרויקט, אחר). */
export function orderChips(names: readonly string[], last: readonly string[]): string[] {
  const tail = last.filter((name) => names.includes(name));
  return [...names.filter((name) => !tail.includes(name)), ...tail];
}

/** The line a manual save writes: the amount is positive, the sign follows the direction. */
export function entryRpcArgs(draft: EntryDraft, kind: EntryKind): {
  p_direction: "expense" | "income";
  p_amount_minor: number;
  p_doc_date: string;
  p_payee: string;
  p_project_id: string | null;
  p_category_id: string;
  p_method: EntryMethod;
  p_cheque_number: string | null;
} {
  const amount = parseAmountMinor(draft.amount) ?? 0;
  const day = parseDisplayDate(draft.date) ?? "";
  const method: EntryMethod = kind === "receipt" ? "cash" : draft.method;
  return {
    p_direction: draft.direction === "in" ? "income" : "expense",
    p_amount_minor: amount,
    p_doc_date: day,
    p_payee: draft.payee.trim(),
    p_project_id: draft.projectId === NO_PROJECT || draft.projectId == null ? null : draft.projectId,
    p_category_id: draft.categoryId ?? "",
    p_method: method,
    p_cheque_number: method === "cheque" ? draft.cheque.trim() : null,
  };
}

/** The types the server takes for a document (add_line_document). */
export const DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;
export const DOCUMENT_MAX_BYTES = 26214400;

/** Why a picked file cannot be attached, or null. The server checks the same rules. */
export function documentProblem(file: { type: string; size: number }): "type" | "size" | "empty" | null {
  if (!(DOCUMENT_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size < 1) return "empty";
  if (file.size > DOCUMENT_MAX_BYTES) return "size";
  return null;
}
