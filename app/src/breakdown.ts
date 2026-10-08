import { formatAmountText, type BreakdownDirection, type BreakdownGroupBy } from "@flow/shared";

/** FLOW-301. Paths, names and the remembered grouping for Home's income and expense breakdown. Decision 0110. */

export const GROUP_BY_KEY = "flow.breakdown.groupBy";

export function isDirection(value: string | undefined): value is BreakdownDirection {
  return value === "income" || value === "expense";
}

export function isGroupBy(value: string | null | undefined): value is BreakdownGroupBy {
  return value === "category" || value === "project" || value === "payer";
}

export function directionLabel(direction: BreakdownDirection): string {
  return direction === "income" ? "נכנס" : "יצא";
}

export function groupByOptions(direction: BreakdownDirection): Array<{ value: BreakdownGroupBy; label: string }> {
  return [
    { value: "category", label: "קטגוריה" },
    { value: "project", label: "פרויקט" },
    { value: "payer", label: direction === "income" ? "לקוח" : "ספק" },
  ];
}

/** The device remembers the last grouping. Storage may be missing or blocked, so every read falls back. */
export function readGroupBy(): BreakdownGroupBy {
  try {
    const value = window.localStorage.getItem(GROUP_BY_KEY);
    return isGroupBy(value) ? value : "category";
  } catch {
    return "category";
  }
}

export function writeGroupBy(value: BreakdownGroupBy): void {
  try {
    window.localStorage.setItem(GROUP_BY_KEY, value);
  } catch {
    // A blocked store only loses the remembered choice.
  }
}

/** The keys the server adds for lines with no category, payer, or project, and for overhead. */
export function isBucketKey(groupBy: BreakdownGroupBy, key: string): boolean {
  return groupBy === "project" ? key === "unassigned" || key === "overhead" : key === "none";
}

/** A group's name. Keys with no name are the buckets the server adds. */
export function groupTitle(
  direction: BreakdownDirection,
  groupBy: BreakdownGroupBy,
  key: string,
  name: string | null | undefined,
): string {
  if (name != null && name.trim() !== "") return name;
  if (groupBy === "project") {
    if (key === "overhead") return "הוצאות כלליות";
    return "בלי פרויקט";
  }
  if (groupBy === "payer") return direction === "income" ? "בלי לקוח" : "בלי ספק";
  return "בלי קטגוריה";
}

export function lineCountHint(count: number, shared: boolean): string {
  const lines = count === 1 ? "תנועה אחת" : `${String(count)} תנועות`;
  return shared ? `${lines} · כולל חלק משותף` : lines;
}

export function breakdownPath(direction: BreakdownDirection, search: string): string {
  return `/flow/${direction}${search}`;
}

export function groupLinesPath(
  direction: BreakdownDirection,
  groupBy: BreakdownGroupBy,
  currency: string,
  key: string,
  search: string,
): string {
  return `/flow/${direction}/${groupBy}/${currency}/${encodeURIComponent(key)}${search}`;
}

export function excludedLinesPath(direction: BreakdownDirection, currency: string, search: string): string {
  return `/flow/${direction}/excluded/${currency}${search}`;
}

/**
 * How Home shows an expense total under its "יצא" label: the label already says the money went
 * out, so a cost reads with no minus (owner, FLOW-334 H3). The minus stays only for a period
 * where refunds beat costs, the one case where the money came back.
 */
export function expenseFigure(agorot: bigint): { agorot: bigint; direction: "expense" | undefined } {
  return agorot < 0n ? { agorot: -agorot, direction: "expense" } : { agorot, direction: undefined };
}

/** "יצא החודש ₪48,320 – פירוט". Every currency is read, in Home's order. */
export function flowLinkName(
  direction: BreakdownDirection,
  period: string,
  rows: Array<{ currency: string; agorot: bigint }>,
): string {
  const amounts = rows
    .map((row) => {
      const figure = direction === "expense" ? expenseFigure(row.agorot) : { agorot: row.agorot, direction: undefined };
      return formatAmountText(figure.agorot, row.currency, { direction: figure.direction });
    })
    .join(", ");
  return `${directionLabel(direction)} ${period} ${amounts} – פירוט`;
}

/** The line's title is who it was with; the hint says where it went, so it never repeats the group. */
export function lineHint(
  groupBy: BreakdownGroupBy,
  row: { project_name: string | null; category_name: string | null; supplier_name: string | null },
): string | null {
  if (groupBy === "project") return row.category_name;
  return row.project_name ?? "בלי פרויקט";
}

export function currencyFirst(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "ILS") return -1;
  if (b === "ILS") return 1;
  return a.localeCompare(b);
}
