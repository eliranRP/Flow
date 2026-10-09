import type { Breakdown, BreakdownDirection, BreakdownGroupBy, BreakdownLinesPage } from "@flow/shared";
import { useParams, useSearchParams } from "react-router-dom";
import { BreakdownLinesScreen, BreakdownScreen } from "../screens/breakdown";

/**
 * FLOW-334: the review cycle's breakdown shots. On the dev server `/flow/expense?preview=1` (or
 * income) and its lines show these invented figures instead of the empty preview; every other
 * preview value (empty, loading, error) stays as it is. App.tsx reaches this only under
 * import.meta.env.DEV, so a production build drops it.
 */

type Group = NonNullable<Breakdown>["groups"][number];

const PERIOD = { basis: "invoiced" as const, from: "2026-07-01", to: "2026-09-30" };

function sum(groups: Group[], currency: string) {
  const mine = groups.filter((group) => group.currency === currency);
  return {
    currency,
    amount_minor: mine.reduce((total, group) => total + group.amount_minor, 0n),
    count: mine.reduce((total, group) => total + group.count, 0),
  };
}

const EXPENSE_GROUPS: Record<BreakdownGroupBy, Group[]> = {
  category: [
    { key: "c-materials", name: "חומרים", currency: "ILS", amount_minor: 1_845_000n, count: 14, shared: true },
    { key: "c-subs", name: "קבלני משנה", currency: "ILS", amount_minor: 1_280_000n, count: 5, shared: false },
    { key: "c-wages", name: "שכר עובדים", currency: "ILS", amount_minor: 820_000n, count: 4, shared: false },
    { key: "c-tools", name: "כלים וציוד", currency: "ILS", amount_minor: 235_000n, count: 6, shared: false },
    { key: "none", name: null, currency: "ILS", amount_minor: 240_000n, count: 3, shared: false },
  ],
  project: [
    { key: "p-herzl", name: "שיפוץ הרצל 12", currency: "ILS", amount_minor: 2_210_000n, count: 15, shared: true },
    { key: "p-villa", name: "וילה רעננה", currency: "ILS", amount_minor: 1_340_000n, count: 9, shared: true },
    { key: "unassigned", name: null, currency: "ILS", amount_minor: 230_000n, count: 3, shared: false },
    { key: "overhead", name: null, currency: "ILS", amount_minor: 640_000n, count: 5, shared: false },
  ],
  payer: [
    { key: "s-stone", name: "אבן וסיד לדוגמה", currency: "ILS", amount_minor: 2_100_000n, count: 12, shared: false },
    { key: "s-haul", name: "הובלות לדוגמה", currency: "ILS", amount_minor: 1_480_000n, count: 9, shared: false },
    { key: "none", name: null, currency: "ILS", amount_minor: 840_000n, count: 11, shared: false },
  ],
};

const INCOME_GROUPS: Record<BreakdownGroupBy, Group[]> = {
  category: [
    { key: "c-work", name: "עבודות", currency: "ILS", amount_minor: 6_100_000n, count: 7, shared: false },
    { key: "c-extra", name: "תוספות", currency: "ILS", amount_minor: 1_150_000n, count: 2, shared: false },
  ],
  project: [
    { key: "p-herzl", name: "שיפוץ הרצל 12", currency: "ILS", amount_minor: 4_250_000n, count: 5, shared: false },
    { key: "p-villa", name: "וילה רעננה", currency: "ILS", amount_minor: 3_000_000n, count: 4, shared: false },
  ],
  payer: [
    { key: "s-dana", name: "לקוחה לדוגמה", currency: "ILS", amount_minor: 4_250_000n, count: 5, shared: false },
    { key: "s-yossi", name: "לקוח לדוגמה", currency: "ILS", amount_minor: 3_000_000n, count: 4, shared: false },
  ],
};

export function sampleBreakdown(direction: BreakdownDirection, groupBy: BreakdownGroupBy): NonNullable<Breakdown> {
  const groups = (direction === "income" ? INCOME_GROUPS : EXPENSE_GROUPS)[groupBy];
  const excluded = direction === "income" ? [] : [{ currency: "ILS", amount_minor: 125_000n, count: 2 }];
  return {
    direction,
    group_by: groupBy,
    ...PERIOD,
    totals: [sum(groups, "ILS")],
    groups,
    excluded,
    review_count: direction === "income" ? 0 : 3,
  };
}

/** Four lines that add up to the group (or the lines kept out) they open from. */
export function sampleBreakdownLines(breakdown: NonNullable<Breakdown>, key: string, excluded: boolean): BreakdownLinesPage {
  const target = excluded ? breakdown.excluded[0] : breakdown.groups.find((group) => group.key === key);
  const total = target?.amount_minor ?? 0n;
  const count = Math.max(1, Math.min(4, target?.count ?? 0));
  // Weights 4:3:2:1 for as many lines as the group has (up to 4); the last line takes the rest.
  const weights = [4n, 3n, 2n, 1n].slice(0, count);
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  const parts = weights.slice(0, -1).map((weight) => (total * weight) / weightSum);
  const amounts = [...parts, total - parts.reduce((a, b) => a + b, 0n)];
  const names = ["אבן וסיד לדוגמה", "מחסני חשמל לדוגמה", "הובלות לדוגמה", "חומרי בניין לדוגמה"];
  return {
    rows: amounts.map((amount, index) => ({
      transaction_id: `t-breakdown-${String(index + 1)}`,
      part: null,
      description: `חשבונית ${String(5521 - index)}`,
      supplier_name: names[index] ?? null,
      project_name: index % 2 === 0 ? "שיפוץ הרצל 12" : "וילה רעננה",
      category_name: "חומרים",
      doc_date: `2026-09-${String(28 - index * 3).padStart(2, "0")}`,
      currency: "ILS",
      amount_minor: amount,
      shared: false,
    })),
    has_more: false,
  };
}

function isDirection(value: string | undefined): value is BreakdownDirection {
  return value === "expense" || value === "income";
}

function isGroupBy(value: string | undefined): value is BreakdownGroupBy {
  return value === "category" || value === "project" || value === "payer";
}

function useSamplePreview(): boolean {
  const [params] = useSearchParams();
  return params.get("preview") === "1";
}

/** `/flow/:direction`: the sample on `?preview=1`, else the screen as is. */
export function DevBreakdownGate() {
  const { direction } = useParams();
  const sample = useSamplePreview();
  if (!sample || !isDirection(direction)) return <BreakdownScreen />;
  const groupBy: BreakdownGroupBy = direction === "income" ? "payer" : "category";
  return <BreakdownScreen key={direction} sample={sampleBreakdown(direction, groupBy)} sampleGroupBy={groupBy} />;
}

/** `/flow/:direction/:groupBy/:currency/:groupKey` and the lines kept out. */
export function DevBreakdownLinesGate({ excluded = false }: { excluded?: boolean }) {
  const { direction, groupBy, groupKey = "" } = useParams();
  const sample = useSamplePreview();
  const by = excluded ? "category" : groupBy;
  if (!sample || !isDirection(direction) || !isGroupBy(by)) return <BreakdownLinesScreen excluded={excluded} />;
  const summary = sampleBreakdown(direction, by);
  const page = sampleBreakdownLines(summary, groupKey, excluded);
  // The header counts the lines it lists (#259), so the opened group counts the sample's lines.
  const count = page?.rows.length ?? 0;
  const breakdown = {
    ...summary,
    groups: summary.groups.map((group) => (group.key === groupKey ? { ...group, count } : group)),
    excluded: summary.excluded.map((sum, index) => (excluded && index === 0 ? { ...sum, count } : sum)),
  };
  return <BreakdownLinesScreen excluded={excluded} sample={{ breakdown, pages: [page] }} />;
}
