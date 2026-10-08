import { describe, expect, it } from "vitest";
import { expectedMonthsSchema, missingBillsSchema } from "./forecast";

describe("missingBillsSchema", () => {
  it("reads the RPC rows as bigint minor units", () => {
    const rows = missingBillsSchema.parse([
      {
        supplier_id: "s1",
        supplier_name: "ספק חשמל לדוגמה",
        currency: "ILS",
        typical_amount_minor: -185_000,
        typical_day: 2,
        expected_by: "2026-10-07",
        months_seen: 5,
        last_doc_date: "2026-09-02",
        project_id: null,
        category_id: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.typical_amount_minor).toBe(-185_000n);
    expect(rows[0]?.expected_by).toBe("2026-10-07");
  });

  it("treats null as no rows and a missing name as empty", () => {
    expect(missingBillsSchema.parse(null)).toEqual([]);
    const [row] = missingBillsSchema.parse([
      { supplier_id: "s", supplier_name: null, currency: "USD", typical_amount_minor: "-1000", typical_day: 1, expected_by: "2026-10-06", months_seen: 3 },
    ]);
    expect(row?.supplier_name).toBe("");
    expect(row?.typical_amount_minor).toBe(-1000n);
  });

  it("refuses a fractional amount", () => {
    expect(() =>
      missingBillsSchema.parse([
        { supplier_id: "s", supplier_name: "x", currency: "ILS", typical_amount_minor: 1.5, typical_day: 1, expected_by: "2026-10-06", months_seen: 3 },
      ]),
    ).toThrow();
  });
});

describe("expectedMonthsSchema", () => {
  it("reads months and the recurring parties", () => {
    const parsed = expectedMonthsSchema.parse({
      today: "2026-10-08",
      project_id: "p1",
      months: [
        { month: "2026-10", open: true, by_currency: [{ currency: "ILS", income_minor: 0, expense_minor: -283_000 }] },
        { month: "2026-11", open: false, by_currency: [] },
      ],
      recurring: [
        { direction: "expense", party_id: "s1", name: null, currency: "ILS", typical_amount_minor: -185_000, typical_day: 2, months_seen: 4, seen_this_month: false, project_id: "p1", category_id: null },
      ],
    });
    expect(parsed.months[0]?.by_currency[0]?.expense_minor).toBe(-283_000n);
    expect(parsed.months[1]?.by_currency).toEqual([]);
    expect(parsed.recurring[0]?.name).toBe("");
  });
});
