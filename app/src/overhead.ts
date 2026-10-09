import { formatAmountText } from "@flow/shared";

/**
 * View-only overhead. The share is each project's income portion of company overhead. Decision 0021 and 0065.
 * FLOW-339: the switch shows its own state, so the hint never repeats it; off has no hint.
 */
export function overheadHint(
  on: boolean,
  detail: { available: boolean; shareAgorot?: bigint | null; currency?: string; scope?: "project" | "company" },
): string | undefined {
  if (!on) return undefined;
  if (detail.scope === "company") return "כל פרויקט מציג רווח אחרי חלקו בכלליות";
  if (!detail.available) return "אין הכנסות בפרויקטים, אז אי אפשר לחלק את הכלליות";
  return `החלק בכלליות ${formatAmountText(detail.shareAgorot ?? 0n, detail.currency ?? "ILS")}`;
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
