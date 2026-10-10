// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cashLinesSchema, cashMonthsSchema } from "./cash";

describe("cashMonthsSchema", () => {
  it("reads cash_months: minor units as bigint, base currency first, an empty month's null rows as none", () => {
    const parsed = cashMonthsSchema.parse({
      basis: "paid",
      base_currency: "ILS",
      months: [
        {
          month: "2026-10-01",
          by_currency: [
            {
              currency: "ILS",
              in_minor: 1_800_000,
              out_minor: "1480000",
              net_minor: 320_000,
              profit_minor: 560_000,
              excluded_count: 2,
              excluded_in_minor: 5_000_000,
              excluded_out_minor: 0,
            },
          ],
        },
        { month: "2026-09-01", by_currency: null },
      ],
    });
    expect(parsed?.months[0]?.by_currency[0]?.out_minor).toBe(1_480_000n);
    expect(parsed?.months[1]?.by_currency).toEqual([]);
    expect(parsed?.months[0]?.by_currency[0]?.not_in_profit_categories).toEqual([]);
  });

  it("reads FLOW-418's not-in-profit categories, signed, as bigint", () => {
    const parsed = cashMonthsSchema.parse({
      basis: "paid",
      base_currency: "USD",
      months: [
        {
          month: "2026-10-01",
          by_currency: [
            {
              currency: "USD",
              in_minor: 500_000,
              out_minor: 900_000,
              net_minor: -400_000,
              profit_minor: -100_000,
              excluded_count: 0,
              excluded_in_minor: 0,
              excluded_out_minor: 0,
              not_in_profit_minor: -300_000,
              not_in_profit_categories: [
                { name: "שיפוץ והשבחה", amount_minor: -500_000 },
                { name: "השקעת בעלים", amount_minor: "200000" },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed?.months[0]?.by_currency[0]?.not_in_profit_categories).toEqual([
      { name: "שיפוץ והשבחה", amount_minor: -500_000n },
      { name: "השקעת בעלים", amount_minor: 200_000n },
    ]);
  });

  it("keeps a signed-out read as null and refuses an unknown basis", () => {
    expect(cashMonthsSchema.parse(null)).toBeNull();
    expect(() => cashMonthsSchema.parse({ basis: "cash", base_currency: "ILS", months: [] })).toThrow();
  });
});

describe("cashLinesSchema", () => {
  it("reads one page of cash_month_lines", () => {
    const parsed = cashLinesSchema.parse({
      rows: [
        {
          transaction_id: "t1",
          part: "principal",
          description: "תשלום הלוואה",
          supplier_name: null,
          project_name: "בית לדוגמה",
          category_name: "קרן הלוואה",
          doc_date: "2026-10-01",
          cash_month_date: "2026-10-02",
          currency: "ILS",
          amount_minor: 410_000,
          side: "out",
          shared: false,
          source: "mercury",
          kept_out: false,
        },
      ],
      has_more: false,
    });
    expect(parsed?.rows[0]?.amount_minor).toBe(410_000n);
    expect(parsed?.rows[0]?.side).toBe("out");
  });
});
