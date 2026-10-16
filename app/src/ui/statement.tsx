import { formatAmountText } from "@flow/shared";
import type { ReactNode } from "react";

/**
 * The method slot under a statement row's amount (FLOW-305): a 16px icon and a short label,
 * never truncated. `spoken` replaces the label in the row's accessible name ("כרטיס שמסתיים ב־4242").
 * `ltr` isolates a Latin label (••4242, ACH).
 */
export type StatementMethod = { icon: ReactNode; text: string; spoken?: string; ltr?: boolean };

/** One muted fact on a statement row's second line. Accent marks a state to act on ("ממתינה לאישור"). */
/** `keep`: a state to act on that never drops off line 2; it shortens instead. `accent` also keeps it. */
export type StatementDetail = { text: string; tone?: "accent"; keep?: boolean };

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
}): string {
  const abs = input.agorot < 0n ? -input.agorot : input.agorot;
  const income = input.sign === "in" && input.agorot >= 0n;
  const text = formatAmountText(abs, input.currency ?? "ILS", { detail: true, direction: income ? "income" : "expense" });
  const word = input.sign === "in" ? input.inWord ?? "הכנסה" : "הוצאה";
  const parts = [
    input.title,
    input.method ? input.method.spoken ?? input.method.text : null,
    input.suggestion ? `${input.suggestionJev === true ? "הצעת Jev" : "הצעה"}: ${input.suggestion}` : null,
    ...(input.details ?? []).map((detail) => detail.text),
    `${word} ${text}`,
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
