import type { Breakdown, BreakdownDirection, ProfitMonth } from "@flow/shared";
import { COMPANY_NEXT_READS } from "./company-next-month-sample";
import type { CompanyProfitSample } from "../screens/company-profit-screen";

/**
 * FLOW-140c1 fixture: the board's Profit frame's structure and figures with invented names (USD, amounts
 * in cents). October so far: income 24,877, counted expenses 28,311 (the board's cents rounded per line, so
 * the project rows' whole figures add up to the head), so the month is a loss;
 * five projects and the general line כללי, the same five lines' categories. Lines are signed (income +).
 */
type Line = [date: string, payee: string, project: string | null, category: string, signed: number];

const PROJECTS: Record<string, string> = { p1: "בית הדקל", p2: "וילה הברושים", p3: "דירת הרימון", p4: "בית השקד", p5: "הבית ברחוב הזית" };
const SHARED = "shared";

const CATEGORY_IDS: Record<string, string> = {
  "עבודות לקוח": "c-client-work",
  "שכירות": "c-rent",
  "החזר ביטוח": "c-insurance-refund",
  "ריבית הלוואות": "c-interest",
  "חומרים": "c-materials",
  "עבודה": "c-labour",
  "מסים וביטוח": "c-tax",
  "תיקונים ותחזוקה": "c-repairs",
  "חשמל ומים": "c-utilities",
  "שכר": "c-payroll",
  "ביטוח עסק": "c-business-insurance",
  "תקשורת": "c-telecom",
  "הנהלת חשבונות": "c-accounting",
};

const LINES: Line[] = [
  ["2026-10-07", "לקוח עבודות", "p1", "עבודות לקוח", 1_500_000],
  ["2026-10-01", "שוכרת א׳", "p3", "שכירות", 185_000],
  ["2026-10-03", "שוכר ב׳", "p3", "שכירות", 230_000],
  ["2026-10-08", "ביטוח מטריה", "p3", "החזר ביטוח", 215_200],
  ["2026-10-02", "שוכרת ג׳", "p4", "שכירות", 185_000],
  ["2026-10-09", "שוכר ד׳", "p4", "שכירות", 172_500],
  ["2026-10-01", "בנק הלוואות", "p2", "ריבית הלוואות", -183_800],
  ["2026-10-05", "ספק חומרים", "p2", "חומרים", -894_000],
  ["2026-10-08", "צוות בניה", "p2", "עבודה", -347_600],
  ["2026-10-04", "בנק הלוואות", "p3", "ריבית הלוואות", -118_000],
  ["2026-10-04", "נאמנות מסים", "p3", "מסים וביטוח", -28_000],
  ["2026-10-10", "חנות כלים", "p3", "תיקונים ותחזוקה", -52_440],
  ["2026-10-06", "אינסטלטור", "p3", "תיקונים ותחזוקה", -52_200],
  ["2026-10-07", "בנק הלוואות", "p4", "ריבית הלוואות", -92_000],
  ["2026-10-07", "נאמנות מסים", "p4", "מסים וביטוח", -36_300],
  ["2026-10-05", "חברת חשמל", "p4", "חשמל ומים", -14_200],
  ["2026-10-10", "שירותי תחזוקה", "p4", "תיקונים ותחזוקה", -147_500],
  ["2026-10-06", "חברת חשמל", "p5", "חשמל ומים", -41_200],
  ["2026-10-09", "חברת מים", "p5", "חשמל ומים", -22_800],
  ["2026-10-02", "משכורות", null, "שכר", -645_000],
  ["2026-10-03", "ביטוח משרד", null, "ביטוח עסק", -61_200],
  ["2026-10-06", "תקשורת", null, "תקשורת", -8_400],
  ["2026-10-09", "משרד רואי חשבון", null, "הנהלת חשבונות", -86_500],
];

function groupBreakdown(direction: BreakdownDirection, groupBy: "project" | "category"): Breakdown {
  const sign = direction === "income" ? 1 : -1;
  const groups = new Map<string, { key: string; name: string | null; shared: boolean; amount: number; count: number; projects: Set<string> }>();
  for (const [, , project, category, signed] of LINES) {
    if (Math.sign(signed) !== sign) continue;
    const key = groupBy === "project" ? (project ?? SHARED) : CATEGORY_IDS[category] ?? category;
    const name = groupBy === "project" ? (project == null ? null : PROJECTS[project] ?? null) : category;
    const group = groups.get(key) ?? { key, name, shared: groupBy === "project" && project == null, amount: 0, count: 0, projects: new Set<string>() };
    group.amount += Math.abs(signed);
    group.count += 1;
    if (project != null) group.projects.add(project);
    groups.set(key, group);
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.amount, 0);
  return {
    direction,
    basis: "cash",
    group_by: groupBy,
    from: "2026-10-01",
    to: "2026-10-31",
    totals: [{ currency: "USD", amount_minor: BigInt(total), count: [...groups.values()].reduce((sum, group) => sum + group.count, 0) }],
    groups: [...groups.values()].map((group) => ({
      currency: "USD",
      key: group.key,
      name: group.name,
      shared: group.shared,
      amount_minor: BigInt(group.amount),
      count: group.count,
      projects: group.projects.size,
    })),
    excluded: [],
    review_count: 0,
  };
}

function linesOf(direction: BreakdownDirection, categoryName: string) {
  const sign = direction === "income" ? 1 : -1;
  return LINES.map((line, index) => ({ line, index }))
    .filter(({ line }) => Math.sign(line[4]) === sign && line[3] === categoryName)
    .map(({ line, index }) => ({
      transaction_id: `t-${String(index + 1)}`,
      part: null,
      description: line[1],
      supplier_name: line[1],
      project_name: line[2] == null ? null : PROJECTS[line[2]] ?? null,
      category_name: line[3],
      doc_date: line[0],
      currency: "USD",
      amount_minor: BigInt(Math.abs(line[4])),
      shared: line[2] == null,
      source: undefined,
    }));
}

const categoryNames = [...new Set(LINES.map((line) => line[3]))];

const income = LINES.filter((line) => line[4] > 0).reduce((sum, line) => sum + line[4], 0);
const expense = -LINES.filter((line) => line[4] < 0).reduce((sum, line) => sum + line[4], 0);

/** The company's months for the chart, May to October (October to date is the page's own month), in dollars. */
function profitMonth(month: string, income: number, expense: number, open = false): ProfitMonth {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return {
    month,
    from: `${month}-01`,
    to: `${month}-${String(last)}`,
    open,
    by_currency: [{ currency: "USD", income_minor: BigInt(income), expense_minor: BigInt(-expense), profit_minor: BigInt(income - expense) }],
  };
}

const MONTHS: ProfitMonth[] = [
  profitMonth("2026-10", income, expense, true),
  profitMonth("2026-09", 1_290_000, 3_762_000),
  profitMonth("2026-08", 2_630_000, 1_971_800),
  profitMonth("2026-07", 2_780_000, 1_880_400),
  profitMonth("2026-06", 3_015_000, 1_784_000),
  profitMonth("2026-05", 2_140_000, 2_300_000),
];

export const COMPANY_PROFIT_SAMPLE: CompanyProfitSample = {
  currency: "USD",
  basis: "cash",
  month: { income: BigInt(income), expense: BigInt(expense) },
  ytdProfit: 3_627_400n,
  projects: { income: groupBreakdown("income", "project"), expense: groupBreakdown("expense", "project") },
  categories: { income: groupBreakdown("income", "category"), expense: groupBreakdown("expense", "category") },
  lines: categoryNames.flatMap((name) => (["income", "expense"] as const).flatMap((direction) => {
    const rows = linesOf(direction, name);
    return rows.length === 0 ? [] : [{ direction, categoryKey: CATEGORY_IDS[name] ?? name, categoryName: name, rows }];
  })),
  today: "2026-10-11",
  monthKey: "2026-10",
  next: { ...COMPANY_NEXT_READS, months: MONTHS },
};
