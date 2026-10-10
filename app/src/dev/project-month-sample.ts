import type { CashLine, ProjectDetail } from "@flow/shared";
import type { ProjectCashMonthLines } from "../project-cash";

/**
 * FLOW-438: invented lines for a project's cash month page and profit page (stories and tests).
 * The design lead's rule (§3.7, FLOW-427): the lines listed on a page add up to its figures, so
 * these sit next to the figures they make up, and project-month-sample.test.ts holds them to it.
 */

/** An earlier month's cash figures (USD): נכנס $3,100, יצא $5,000, רווח $950. */
export const SAMPLE_MONTH_FIGURES = { in_minor: 310_000n, out_minor: 500_000n, profit_minor: 95_000n };

/** What that month's profit leaves out: the loan's principal (net less profit, −$2,850). */
export const SAMPLE_MONTH_KEPT = [{ name: "תשלומי הלוואה", amount_minor: -285_000n }];

function cashLine(month: string, day: number, supplier: string, category: string, minor: bigint, side: "in" | "out"): CashLine {
  const date = `${month}-${String(day).padStart(2, "0")}`;
  return {
    transaction_id: `${month}-${String(day)}`,
    part: null,
    description: supplier,
    supplier_name: supplier,
    project_name: null,
    category_name: category,
    doc_date: date,
    cash_month_date: date,
    currency: "USD",
    amount_minor: minor,
    side,
    source: "mercury",
  };
}

/** The lines behind SAMPLE_MONTH_FIGURES, dated in that month ("YYYY-MM"). */
export function sampleMonthLines(month: string): ProjectCashMonthLines {
  return {
    counted: [
      cashLine(month, 3, "שוכר לדוגמה", "שכירות", 310_000n, "in"),
      cashLine(month, 2, "חנות חומרים לדוגמה", "תיקונים ותחזוקה", 155_000n, "out"),
      cashLine(month, 6, "מלווה לדוגמה", "ריבית משכנתא", 60_000n, "out"),
    ],
    kept: [cashLine(month, 5, "מלווה לדוגמה", "תשלומי הלוואה", 285_000n, "out")],
    more: false,
  };
}

type ProjectLine = NonNullable<ProjectDetail>["transactions"][number];

/** A month's profit figures (USD): הכנסות $3,100, הוצאות $1,820, רווח $1,280. */
export const SAMPLE_PROFIT_FIGURES = { income_minor: 310_000n, direct_minor: 182_000n, profit_minor: 128_000n };

/** The lines behind SAMPLE_PROFIT_FIGURES, plus a loan principal the profit keeps out (not listed). */
export function sampleProfitLines(month: string): ProjectLine[] {
  return [
    { id: "t1", description: "שכירות לדוגמה", doc_date: `${month}-03`, amount_net: 310_000n, currency: "USD", direction: "income", category: null },
    { id: "t2", description: "חנות חומרים לדוגמה", doc_date: `${month}-02`, amount_net: -122_000n, currency: "USD", direction: "expense", category: "שיפוץ" },
    { id: "t3", description: "מלווה לדוגמה", doc_date: `${month}-06`, amount_net: -60_000n, currency: "USD", direction: "expense", category: "ריבית משכנתא" },
    { id: "t4", description: "מלווה לדוגמה", doc_date: `${month}-06`, amount_net: -200_000n, currency: "USD", direction: "expense", category: "תשלומי הלוואה", kept_out: true },
  ];
}
