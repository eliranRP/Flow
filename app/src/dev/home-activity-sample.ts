import type { CashLine } from "@flow/shared";

/**
 * FLOW-1036 fixture: the current month's lines behind Home's חד-פעמי group (invented names, cents; USD unless `currency` says otherwise). Most are
 * one-off (`recurring: false`); the two recurring ones are the schedule's arrived charges (recurring-sample.ts),
 * so they stay out of the group. `month` is YYYY-MM.
 */
export function homeActivityLines(month: string, { flag = true, currency = "USD" }: { flag?: boolean; currency?: string } = {}): CashLine[] {
  const line = (id: string, day: string, name: string, side: "in" | "out", dollars: number, recurring: boolean, project: string | null = null): CashLine => ({
    transaction_id: id,
    part: null,
    description: name,
    supplier_name: name,
    project_name: project,
    category_name: null,
    doc_date: `${month}-${day}`,
    cash_month_date: `${month}-${day}`,
    currency,
    amount_minor: BigInt(dollars * 100),
    side,
    ...(flag ? { recurring } : {}),
  });
  return [
    line("t-lumber", "09", "Oakridge Lumber", "out", 1_180, false, "Birch Lane"),
    line("t-sale", "08", "Juniper Ct closing", "in", 5_040, false, "Juniper Ct"),
    line("t-grocer", "03", "Greenway Market", "out", 212, false),
    line("t-fuel", "05", "Northstar Fuel", "out", 80, false),
    line("t-water", "05", "Bayside Water Utility", "out", 142, true, "Elm Row"),
    line("t-rent", "01", "Birch Lane rent", "in", 2_100, true, "Birch Lane"),
  ];
}
