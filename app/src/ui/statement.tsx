import { formatAmountText } from "@flow/shared";
import type { ReactNode } from "react";
import { withCents } from "./big-number";
import { methodLabel, type TxnMeta } from "../txn-meta";
import { BankIcon, CameraIcon, CardIcon, DocumentIcon, TransferIcon } from "./icons";

/**
 * The method slot under a statement row's amount (FLOW-305): a 16px icon and a short label,
 * never truncated. `spoken` replaces the label in the row's accessible name ("כרטיס שמסתיים ב־4242").
 * `ltr` isolates a Latin label (••4242, ACH).
 */
export type StatementMethod = { icon: ReactNode; text: string; spoken?: string; ltr?: boolean };

/** One muted fact on a statement row's second line. Accent marks a state to act on ("ממתינה לאישור"). */
export type StatementDetail = { text: string; tone?: "accent" };

export type StatementSource = "sumit" | "mercury" | "manual" | "photo";

/**
 * The method a review row shows, from its source and document kind. A bank line with FLOW-304
 * bank details says how the money moved (••4242, ACH, העברה בנקאית, צ׳ק); one without says "בנק".
 * A SUMIT document says its kind ("חשבונית", "קבלה"), so every row keeps one height.
 */
export function statementMethodOf(
  source: StatementSource | undefined,
  docKind: string | undefined,
  meta?: Pick<TxnMeta, "method" | "card_last4"> | null,
): StatementMethod | null {
  const fromMeta = source === "mercury" ? statementMethodFromMeta(meta) : null;
  if (fromMeta) return fromMeta;
  if (source === "mercury") return { icon: <BankIcon size={16} />, text: "בנק" };
  if (source === "photo") return { icon: <CameraIcon size={16} />, text: "צילום" };
  if (source === "manual") return { icon: <DocumentIcon size={16} stroke={1.9} />, text: "ידני" };
  if (source === "sumit" || docKind != null) return { icon: <DocumentIcon size={16} stroke={1.9} />, text: docKindShort(docKind) };
  return null;
}

/**
 * FLOW-304's short method label as a statement method. Null for no meta or `other`, so the
 * caller keeps "בנק". Only the last 4 card digits ever reach the label (`methodLabel`).
 */
export function statementMethodFromMeta(meta: Pick<TxnMeta, "method" | "card_last4"> | null | undefined): StatementMethod | null {
  const label = methodLabel(meta);
  if (label == null) return null;
  const icon =
    label.icon === "card" ? <CardIcon size={16} /> : label.icon === "transfer" ? <TransferIcon size={16} /> : <DocumentIcon size={16} stroke={1.9} />;
  const ltr = !/[\u0590-\u05FF]/u.test(label.short);
  return {
    icon,
    text: label.short,
    ...(label.spoken !== label.short ? { spoken: label.spoken } : {}),
    ...(ltr ? { ltr: true } : {}),
  };
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
 * the line-2 details, the direction word and the amount, then "בהמתנה". The avatar, icons and ✦ are hidden.
 */
export function statementRowLabel(input: {
  title: string;
  method?: StatementMethod | null;
  suggestion?: string | null;
  suggestionJev?: boolean;
  agorot: bigint;
  currency?: string;
  sign: "in" | "out";
  inWord?: string;
  pending?: boolean;
  details?: readonly StatementDetail[];
  realCents?: boolean;
}): string {
  const abs = input.agorot < 0n ? -input.agorot : input.agorot;
  const income = input.sign === "in" && input.agorot >= 0n;
  const text = formatAmountText(abs, input.currency ?? "ILS", { detail: true, direction: income ? "income" : "expense" });
  const amount = input.realCents === true ? text : withCents(text);
  const word = input.sign === "in" ? input.inWord ?? "הכנסה" : "הוצאה";
  const parts = [
    input.title,
    input.method ? input.method.spoken ?? input.method.text : null,
    input.suggestion ? `${input.suggestionJev === true ? "הצעת Jev" : "הצעה"}: ${input.suggestion}` : null,
    ...(input.details ?? []).map((detail) => detail.text),
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
