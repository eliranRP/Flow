import type { CashLine } from "@flow/shared";
import type { ProjectMonthProfitSample } from "../screens/project-month-profit-screen";
import { JUNIPER_PROFIT } from "./project-profit-sample";

/** One counted line of the October sample: a payee, its category, and the signed amount in cents. */
function line(id: string, day: string, payee: string, category: string, signedMinor: bigint): CashLine {
  const date = `2026-10-${day}`;
  return {
    transaction_id: id,
    part: null,
    description: payee,
    supplier_name: payee,
    project_name: "Juniper Ct",
    category_name: category,
    doc_date: date,
    cash_month_date: date,
    currency: "USD",
    amount_minor: signedMinor < 0n ? -signedMinor : signedMinor,
    side: signedMinor < 0n ? "out" : "in",
    source: "bank",
    pending: false,
    in_pnl: true,
    parts: null,
    line_minor: null,
  };
}

/**
 * FLOW-140 slice 2 fixture: Juniper Ct's October (open month, "עד היום, 16/10"): the brief's seven counted
 * lines, which add to income $6,302, counted expenses $2,506 and profit $3,796 (the brief's §5 figures).
 */
export const JUNIPER_MONTH_PROFIT: ProjectMonthProfitSample = {
  month: "2026-10",
  project: {
    ...JUNIPER_PROFIT.project,
    income_agorot: 630_200n,
    direct_agorot: 250_640n,
    profit_agorot: 379_560n,
    by_currency: [{ currency: "USD", income_minor: 630_200n, direct_minor: 250_640n, shared_minor: 0n, profit_minor: 379_560n }],
    categories: [],
    transactions: [],
  },
  lines: [
    line("t-northline", "10", "Northline Supply", "תיקונים ותחזוקה", -52_440n),
    line("t-keystone", "08", "Keystone Mutual", "החזר ביטוח", 215_200n),
    line("t-clearflow", "06", "Clearflow Plumbing", "תיקונים ותחזוקה", -52_200n),
    line("t-northgate-escrow", "04", "Northgate Mortgage · escrow", "מסים וביטוח", -28_000n),
    line("t-northgate", "04", "Northgate Mortgage", "ריבית הלוואות", -118_000n),
    line("t-kim", "03", "S. Kim", "שכירות", 230_000n),
    line("t-ortiz", "01", "M. Ortiz", "שכירות", 185_000n),
  ],
};
