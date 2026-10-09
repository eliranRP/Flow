import { formatAmountText } from "@flow/shared";

/** View-only overhead. The share is each project's income portion of company overhead. Decision 0021 and 0065. */
export function overheadHint(
  on: boolean,
  detail: { available: boolean; shareAgorot?: bigint | null; currency?: string; scope?: "project" | "company" },
): string {
  if (!on) return "כבוי · מציג רווח לפני הוצאות כלליות";
  if (detail.scope === "company") return "דלוק · כל פרויקט מציג רווח אחרי חלקו בהוצאות הכלליות";
  if (!detail.available) return "דלוק · אין הכנסות בפרויקטים, אז אי אפשר לחלק את ההוצאות הכלליות";
  return `דלוק · החלק בהוצאות הכלליות הוא ${formatAmountText(detail.shareAgorot ?? 0n, detail.currency ?? "ILS")}`;
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
