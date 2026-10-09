import { formatAmountText } from "@flow/shared";

/** View-only overhead. The share is each project's income portion of company overhead. Decision 0021 and 0065. */
/**
 * The project switch's hint (FLOW-334): the switch shows on or off, so the hint says only the share.
 * Off has no hint; Settings words the same switch with a plain label.
 */
export function overheadHint(
  on: boolean,
  detail: { available: boolean; shareAgorot?: bigint | null; currency?: string },
): string | undefined {
  if (!on) return undefined;
  if (!detail.available) return "אין הכנסות בפרויקטים לחלוקה";
  return `החלק בהוצאות הכלליות: ${formatAmountText(detail.shareAgorot ?? 0n, detail.currency ?? "ILS")}`;
}

export function shownProfit(
  on: boolean,
  available: boolean,
  profit: bigint,
  after: bigint | null | undefined,
): bigint {
  if (!on || !available) return profit;
  return after ?? profit;
}
