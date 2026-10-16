import type { ProfitMonth, ProfitMonths } from "@flow/shared";
import type { ProjectProfitSample } from "../screens/project-profit-screen";

/**
 * FLOW-140 slice 1 fixture: the ProfitProject board frame's figures (USD, amounts in cents), with an invented
 * project name. Profit since the start: income 76,050, counted expenses 54,570, the share of general expenses
 * 3,040, after overhead 18,440, the big figure 21,480. Twenty months since March 2025, newest first; the six
 * newest rows are the board's, the other fourteen split the rest.
 */
const OPEN_AND_RECENT: [string, number, number][] = [
  ["2026-10", 630_200, 250_600],
  ["2026-09", 415_000, 174_000],
  ["2026-08", 415_000, 176_000],
  ["2026-07", 415_000, 170_000],
  ["2026-06", 415_000, 187_000],
  ["2026-05", 415_000, 180_000],
];
const EARLIER: [string, number, number][] = [
  ...["2026-04", "2026-03", "2026-02", "2026-01", "2025-12", "2025-11", "2025-10", "2025-09", "2025-08", "2025-07", "2025-06", "2025-05", "2025-04"].map((m): [string, number, number] => [m, 350_000, 308_500]),
  ["2025-03", 349_800, 308_900],
];

function monthRow(key: string, income: number, expense: number, open: boolean): ProfitMonth {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const last = new Date(year, month, 0).getDate();
  return {
    month: key,
    from: `${key}-01`,
    to: `${key}-${String(last).padStart(2, "0")}`,
    open,
    by_currency: [{ currency: "USD", income_minor: BigInt(income), expense_minor: BigInt(expense), profit_minor: BigInt(income - expense) }],
  };
}

const MONTHS = [...OPEN_AND_RECENT, ...EARLIER].map(([key, income, expense], index) => monthRow(key, income, expense, index === 0));

export const JUNIPER_PROFIT: ProjectProfitSample = {
  project: {
    id: "juniper-ct",
    name: "Juniper Ct",
    status: "active",
    state_label: "פעיל",
    base_currency: "USD",
    budget_agorot: null,
    income_agorot: 7_605_000n,
    direct_agorot: 5_457_000n,
    shared_agorot: 0n,
    profit_agorot: 2_148_000n,
    by_currency: [{ currency: "USD", income_minor: 7_605_000n, direct_minor: 5_457_000n, shared_minor: 0n, profit_minor: 2_148_000n }],
    overhead_weighted: true,
    overhead_share_minor: 304_000n,
    after_overhead: true,
    categories: [],
    pending_count: 0,
    pending_agorot: 0n,
    transactions: [],
  },
  months: {
    basis: "cash",
    from: "2025-03-01",
    to: "2026-10-16",
    project_id: "juniper-ct",
    after_overhead: true,
    base_currency: "USD",
    months: MONTHS,
    by_currency: [{ currency: "USD", income_minor: 7_605_000n, expense_minor: 5_457_000n, profit_minor: 2_148_000n }],
  } satisfies NonNullable<ProfitMonths>,
};

/** A project with no line yet: its page has no months and no figures to show. */
export const NEW_PROJECT_PROFIT: ProjectProfitSample = {
  project: { ...JUNIPER_PROFIT.project, id: "linden-ct", name: "Linden Ct", by_currency: [], income_agorot: 0n, direct_agorot: 0n, profit_agorot: 0n },
  months: { ...JUNIPER_PROFIT.months, project_id: "linden-ct", months: [], by_currency: [] },
};
