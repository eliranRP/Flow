/** View-only overhead. The share stays 0 until owner weights exist. Decision 0064. */

export function overheadHint(on: boolean, weighted: boolean): string {
  if (!on) return "כבוי · מציג רווח לפני כלליות";
  if (!weighted) return "דלוק · אין עדיין משקלות, החלק בכלליות הוא ₪0";
  return "דלוק · מציג רווח אחרי כלליות";
}

export function shownProfit(
  on: boolean,
  profit: bigint,
  after: bigint | null | undefined,
  share: bigint | null | undefined,
): bigint {
  if (!on) return profit;
  if (after != null) return after;
  return profit - (share ?? 0n);
}
