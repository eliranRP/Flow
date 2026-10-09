import type { Dashboard, ProjectRow } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { companyRows, primaryCurrency, profitSign, projectRows } from "./by-currency";

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p1",
    name: "Sample",
    status: "active",
    income_agorot: 100_000n,
    direct_agorot: 40_000n,
    shared_agorot: 10_000n,
    profit_before_shared_agorot: 60_000n,
    profit_agorot: 50_000n,
    by_currency: [],
    ...overrides,
  };
}

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    company_id: "c1",
    name: "Co",
    vat_registered: true,
    basis: "invoiced",
    from: null,
    to: null,
    income_agorot: 0n,
    direct_agorot: 0n,
    shared_agorot: 0n,
    overhead_agorot: 0n,
    expense_agorot: 0n,
    net_profit_agorot: 0n,
    prev_income_agorot: null,
    prev_expense_agorot: null,
    prev_net_agorot: null,
    active_projects: 0,
    review_count: 0,
    projects: [],
    by_currency: [],
    ...overrides,
  };
}

describe("by-currency helpers", () => {
  it("prefers by_currency over agorot fields and orders ILS first", () => {
    const rows = projectRows(project({
      income_agorot: 0n,
      direct_agorot: 0n,
      shared_agorot: 0n,
      profit_agorot: 0n,
      by_currency: [
        { currency: "USD", income_minor: 200_000n, direct_minor: 50_000n, shared_minor: 0n, profit_minor: 150_000n },
        { currency: "ILS", income_minor: 10_000n, direct_minor: 0n, shared_minor: 0n, profit_minor: 10_000n },
      ],
    }));
    expect(rows.map((row) => row.currency)).toEqual(["ILS", "USD"]);
    expect(rows[1]?.profit_minor).toBe(150_000n);
  });

  it("falls back to one ILS bucket and drops all-zero buckets but keeps one row", () => {
    expect(projectRows(project()).map((row) => row.currency)).toEqual(["ILS"]);
    const company = companyRows(dashboard({
      by_currency: [
        { currency: "USD", income_minor: 0n, direct_minor: 0n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 0n, net_profit_minor: 0n, count: 0 },
        { currency: "ILS", income_minor: 0n, direct_minor: 0n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 0n, net_profit_minor: 0n, count: 0 },
      ],
    }));
    expect(company).toHaveLength(1);
    expect(company[0]?.currency).toBe("ILS");
  });

  it("puts the company currency first and ranks by it (0147)", () => {
    const rows = [
      { currency: "ILS", income_minor: 1n, direct_minor: 0n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 0n, net_profit_minor: 1n, count: 9 },
      { currency: "USD", income_minor: 1n, direct_minor: 0n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 0n, net_profit_minor: 1n, count: 1 },
    ];
    const usd = dashboard({ base_currency: "USD", by_currency: rows });
    expect(companyRows(usd, "USD").map((row) => row.currency)).toEqual(["USD", "ILS"]);
    expect(primaryCurrency(usd)).toBe("USD");
    expect(companyRows(dashboard({ by_currency: rows })).map((row) => row.currency)).toEqual(["ILS", "USD"]);
  });

  it("breaks primaryCurrency ties toward ILS", () => {
    const rows = dashboard({
      by_currency: [
        { currency: "USD", income_minor: 1n, direct_minor: 0n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 0n, net_profit_minor: 1n, count: 2 },
        { currency: "ILS", income_minor: 1n, direct_minor: 0n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 0n, net_profit_minor: 1n, count: 2 },
      ],
    });
    expect(primaryCurrency(rows)).toBe("ILS");
  });
});

describe("empty period in a non-shekel company", () => {
  const zeros = { income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n };

  it("shows the project's zero row in the company currency", () => {
    const rows = projectRows(project({ ...zeros, by_currency: [] }), "USD");
    expect(rows).toEqual([{ currency: "USD", income_minor: 0n, direct_minor: 0n, shared_minor: 0n, profit_minor: 0n }]);
  });

  it("keeps ILS for a shekel company and ignores the fallback when there are figures", () => {
    expect(projectRows(project({ ...zeros, by_currency: [] }))[0]?.currency).toBe("ILS");
    expect(projectRows(project(), "USD")[0]?.currency).toBe("ILS");
  });

  it("shows the company's zero row in the company currency", () => {
    const rows = companyRows(dashboard(), "USD");
    expect(rows.map((row) => row.currency)).toEqual(["USD"]);
    expect(companyRows(dashboard()).map((row) => row.currency)).toEqual(["ILS"]);
  });
});

describe("profitSign (FLOW-339)", () => {
  it("calls a profit in one currency and a loss in another mixed", () => {
    expect(profitSign([100n, -50n])).toBe("mixed");
    expect(profitSign([-100n, -50n])).toBe("loss");
    expect(profitSign([0n, -50n])).toBe("loss");
    expect(profitSign([0n, 50n])).toBe("profit");
    expect(profitSign([0n])).toBe("profit");
    expect(profitSign([])).toBe("profit");
  });
});
