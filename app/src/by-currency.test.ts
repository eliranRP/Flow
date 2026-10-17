// @vitest-environment node
import type { ProjectRow } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { profitSign, projectRows } from "./by-currency";

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
