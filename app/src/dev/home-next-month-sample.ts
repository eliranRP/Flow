import type { CashCurrencyRow, CashMonths, ProjectCashRow, ProjectsCashMonth } from "@flow/shared";
import type { HomeNextMonthSample } from "../screens/home-next-month";
import { COMPANY_NEXT_READS } from "./company-next-month-sample";

/**
 * FLOW-990 fixture: Home's and the Projects tab's next month, on the company profit sample's projects (invented
 * names, USD cents). Today is 11/10/2026, so next month is November: the forecast's reads are the company profit
 * page's (COMPANY_NEXT_READS), and the cash months are May to October, October to date.
 */
export const NEXT_MONTH_TODAY = "2026-10-11";

function row(dollarsIn: number, dollarsOut: number, profitDollars: number): CashCurrencyRow {
  const inMinor = BigInt(dollarsIn * 100);
  const outMinor = BigInt(dollarsOut * 100);
  return {
    currency: "USD",
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: BigInt(profitDollars * 100),
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
    not_in_profit_categories: [],
  };
}

export const NEXT_MONTH_CASH: NonNullable<CashMonths> = {
  basis: "paid",
  base_currency: "USD",
  months: [
    { month: "2026-10-01", by_currency: [row(18_000, 22_200, -1_260)] },
    { month: "2026-09-01", by_currency: [row(15_000, 21_000, -900)] },
    { month: "2026-08-01", by_currency: [row(20_000, 19_000, 1_000)] },
    { month: "2026-07-01", by_currency: [row(17_000, 24_000, -2_000)] },
    { month: "2026-06-01", by_currency: [row(21_000, 18_000, 3_000)] },
    { month: "2026-05-01", by_currency: [row(16_000, 19_000, -500)] },
  ],
};

export const HOME_NEXT_MONTH_SAMPLE: HomeNextMonthSample = {
  next: { ...COMPANY_NEXT_READS, months: [] },
  cash: NEXT_MONTH_CASH,
};

function project(id: string, name: string, type: string, dollars: number, overhead = false): ProjectCashRow {
  const net = dollars * 100;
  return {
    id,
    name,
    type,
    status: "active",
    is_overhead: overhead,
    group_id: null,
    created_at: "2026-05-01T08:00:00Z",
    finished_on: null,
    budget_minor: null,
    spent_minor: 0,
    cash: [{ currency: "USD", in_minor: Math.max(net, 0), out_minor: Math.max(-net, 0), net_minor: net }],
    profit_month_minor: net,
    profit_all_minor: net,
    first_month: "2026-05-01",
    pending_count: 0,
    deletable: false,
  };
}

/** The Projects tab's October on the same projects, so each next-month part lands on its row. */
export const NEXT_MONTH_PROJECTS: NonNullable<ProjectsCashMonth> = {
  month: "2026-10-01",
  base_currency: "USD",
  basis: "paid",
  projects: [
    project("p1", "בית הדקל", "לקוח", 15_000),
    project("p2", "וילה הברושים", "flip", -14_253),
    project("p3", "דירת הרימון", "השכרה", 2_150),
    project("p4", "בית השקד", "השכרה", 1_950),
    project("p5", "הבית ברחוב הזית", "השכרה", 3_400),
  ],
  unassigned: { count: 0, cash: [] },
};
