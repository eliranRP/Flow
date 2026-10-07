import { formatAmountText } from "@flow/shared";
import type { ReactNode } from "react";
import { withCents } from "./big-number";
import { BankIcon, CameraIcon, DocumentIcon } from "./icons";

/**
 * The method slot under a statement row's amount (FLOW-305): a 16px icon and a short label,
 * never truncated. `spoken` replaces the label in the row's accessible name ("כרטיס שמסתיים ב־4242").
 * `ltr` isolates a Latin label (••4242, ACH).
 */
export type StatementMethod = { icon: ReactNode; text: string; spoken?: string; ltr?: boolean };

export type StatementSource = "sumit" | "mercury" | "manual" | "photo";

/**
 * The method a review row can show today, from its source and document kind. A bank line says
 * "בנק"; a SUMIT document says its kind ("חשבונית", "קבלה"), so every row keeps one height.
 * Card, ACH and wire labels need the bank line's meta (FLOW-304) and are not drawn here yet.
 */
export function statementMethodOf(source: StatementSource | undefined, docKind: string | undefined): StatementMethod | null {
  if (source === "mercury") return { icon: <BankIcon size={16} />, text: "בנק" };
  if (source === "photo") return { icon: <CameraIcon size={16} />, text: "צילום" };
  if (source === "manual") return { icon: <DocumentIcon size={16} stroke={1.9} />, text: "ידני" };
  if (source === "sumit" || docKind != null) return { icon: <DocumentIcon size={16} stroke={1.9} />, text: docKindShort(docKind) };
  return null;
}

/** Short document kind for the method slot (≤ 70px at 15px). */
export function docKindShort(kind: string | undefined): string {
  if (kind === "invoice" || kind === "invoice_receipt") return "חשבונית";
  if (kind === "receipt") return "קבלה";
  if (kind === "credit") return "זיכוי";
  return "מסמך";
}

/**
 * The statement row's link name, in reading order: counterparty, method in words, the suggestion,
 * the direction word and the amount, then "בהמתנה". The avatar, icons and ✦ are hidden.
 */
export function statementRowLabel(input: {
  title: string;
  method?: StatementMethod | null;
  suggestion?: string | null;
  agorot: bigint;
  currency?: string;
  sign: "in" | "out";
  inWord?: string;
  pending?: boolean;
}): string {
  const abs = input.agorot < 0n ? -input.agorot : input.agorot;
  const income = input.sign === "in" && input.agorot >= 0n;
  const amount = withCents(formatAmountText(abs, input.currency ?? "ILS", { detail: true, direction: income ? "income" : "expense" }));
  const word = input.sign === "in" ? input.inWord ?? "הכנסה" : "הוצאה";
  const parts = [
    input.title,
    input.method ? input.method.spoken ?? input.method.text : null,
    input.suggestion ? `הצעה: ${input.suggestion}` : null,
    `${word} ${amount}`,
    input.pending ? "בהמתנה" : null,
  ];
  return parts.filter((part): part is string => part != null && part !== "").join(", ");
}

/** "rtl" or "ltr" from the first strong character, so a Latin counterparty cuts at its end. */
export function textDir(text: string): "rtl" | "ltr" | undefined {
  const match = /[A-Za-zא-ת]/.exec(text);
  if (match == null) return undefined;
  return /[A-Za-z]/.test(match[0]) ? "ltr" : "rtl";
}
