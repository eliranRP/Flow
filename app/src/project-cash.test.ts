import type { CashCurrencyRow } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { projectCashSummaryRows, projectEarlierMonthRows, projectProfitPath } from "./project-cash";

const NOW = new Date("2026-10-10T09:00:00Z");

function row(inMinor: bigint, outMinor: bigint, profit: bigint, currency = "USD"): CashCurrencyRow {
  return {
    currency,
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
  };
}

describe("FLOW-419 project cash rows", () => {
  it("opens the project's lines and the project's profit page on the month", () => {
    const rows = projectCashSummaryRows("p1", "2026-10", [row(310_000n, 75_000n, 128_000n)], "?preview=1", NOW);
    expect(rows.map((r) => r.label)).toEqual(["נכנס", "יצא", "רווח החודש"]);
    expect(rows[0]?.href).toBe("/projects/p1/cash/2026-10/in/USD?preview=1");
    expect(rows[1]?.href).toBe("/projects/p1/cash/2026-10/out/USD?preview=1");
    expect(rows[2]?.href).toMatch(/^\/projects\/p1\/profit\?preview=1&period=month&at=2026-10/);
    // The profit page reads the month from its link, so Home's period is left alone.
    expect(rows[2]?.profitMonth).toBeUndefined();
  });

  it("lists the earlier months, each opening its own page", () => {
    const data = {
      basis: "paid" as const,
      base_currency: "USD",
      months: [
        { month: "2026-10-01", by_currency: [row(1n, 0n, 0n)] },
        { month: "2026-09-01", by_currency: [row(310_000n, 500_000n, 95_000n)] },
      ],
    };
    const rows = projectEarlierMonthRows("p1", data, "", NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("ספטמבר");
    expect(rows[0]?.amounts).toEqual([{ currency: "USD", minor: -190_000n }]);
    expect(rows[0]?.href).toBe("/projects/p1/cash/2026-09");
  });

  it("names the profit page's path", () => {
    expect(projectProfitPath("p 1", "")).toBe("/projects/p 1/profit");
  });
});
