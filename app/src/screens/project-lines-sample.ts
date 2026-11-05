import type { CashLine } from "@flow/shared";
import type { ScheduleRow } from "../recurring-schedule";

/**
 * FLOW-1044: a project's month as the page groups it, for the stories: its recurring charges (recurring_schedule)
 * and the month's lines with FLOW-1035's flag, so the one-off group shows. Invented names and amounts.
 */
export function projectScheduleSample(projectId: string, currency = "USD"): ScheduleRow[] {
  const row = (over: Partial<ScheduleRow> & Pick<ScheduleRow, "party_id" | "party_name" | "state">): ScheduleRow => ({
    direction: "expense",
    currency,
    typical_amount_minor: -100_000,
    amount_minor: null,
    typical_day: 10,
    pace: "month",
    next_due_month: "2026-11",
    expected_by: "2026-11-10",
    project_id: projectId,
    project_name: null,
    category_id: null,
    category_name: null,
    ...over,
  });
  return [
    row({ party_id: "s-frame", party_name: "Frame contractor", state: "soon", typical_amount_minor: -420_000, typical_day: 20, category_name: "קבלני משנה" }),
    row({ party_id: "s-tax", party_name: "City tax", state: "late", typical_amount_minor: -41_200, typical_day: 3, category_name: "ארנונה" }),
    row({ party_id: "s-loan", party_name: "Bridge loan", state: "arrived", typical_amount_minor: -98_000, amount_minor: -98_000, category_name: "ריבית" }),
    row({ party_id: "s-rent", party_name: "Tenant rent", direction: "income", state: "arrived", typical_amount_minor: 320_000, amount_minor: 320_000, typical_day: 1, category_name: "שכירות" }),
  ];
}

export function projectLinesSample(currency = "USD"): CashLine[] {
  const line = (id: string, supplier: string, day: string, minor: bigint, category: string, recurring: boolean): CashLine => ({
    transaction_id: id,
    part: null,
    description: supplier,
    supplier_name: supplier,
    project_name: null,
    category_name: category,
    doc_date: `2026-11-${day}`,
    cash_month_date: `2026-11-${day}`,
    currency,
    amount_minor: minor,
    side: "out",
    recurring,
  });
  return [
    line("t-loan", "Bridge loan", "10", 98_000n, "ריבית", true),
    line("t-mat", "Building supplies", "09", 118_000n, "חומרים", false),
    line("t-elec", "Electrician", "05", 809_300n, "קבלני משנה", false),
  ];
}
