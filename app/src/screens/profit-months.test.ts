import type { ProfitMonths } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { profitMonthsSummary, rangeCurrencies } from "./profit-months";

type Data = NonNullable<ProfitMonths>;
const zeroIls = { currency: "ILS", income_minor: 0n, expense_minor: 0n, profit_minor: 0n };

function usdMonth(month: string, income: bigint, expense: bigint, open = false): Data["months"][number] {
  return {
    month,
    from: `${month}-01`,
    to: `${month}-28`,
    open,
    by_currency: [zeroIls, { currency: "USD", income_minor: income, expense_minor: expense, profit_minor: income - expense }],
  };
}

function data(months: Data["months"]): Data {
  return {
    months,
    by_currency: [zeroIls, { currency: "USD", income_minor: 500_00n, expense_minor: 200_00n, profit_minor: 300_00n }],
  } as unknown as Data;
}

describe("profit months currencies (USD company)", () => {
  it("drops the server's zero ILS row and leads with USD", () => {
    expect(rangeCurrencies(data([usdMonth("2026-09", 500_00n, 200_00n)]), "ILS")).toEqual(["USD"]);
  });

  it("falls back to the company currency when the period has no figures", () => {
    const empty = { months: [], by_currency: [zeroIls] } as unknown as Data;
    expect(rangeCurrencies(empty, "USD")).toEqual(["USD"]);
    expect(rangeCurrencies(empty, "ILS")).toEqual(["ILS"]);
  });

  it("counts USD months as profit or loss, not the zero ILS row", () => {
    const summary = profitMonthsSummary(data([usdMonth("2026-09", 500_00n, 200_00n), usdMonth("2026-08", 0n, 100_00n)]), "USD");
    expect(summary).toContain("1 ברווח");
    expect(summary).toContain("1 בהפסד");
  });

  it("takes the overhead share off the company currency's row (0147)", () => {
    const month = { ...usdMonth("2026-09", 500_00n, 200_00n), overhead_weighted: true, overhead_share_agorot: 0n, overhead_share_minor: 400_00n };
    const shared = { ...data([month]), after_overhead: true, base_currency: "USD" } as Data;
    expect(profitMonthsSummary(shared, "USD")).toContain("1 בהפסד");
    expect(profitMonthsSummary({ ...shared, after_overhead: false }, "USD")).toContain("1 ברווח");
  });
});
