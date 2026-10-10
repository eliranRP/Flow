import { describe, expect, it } from "vitest";
import { expectedMonthsSchema, missingBillsSchema, paymentRecurringSchema, recurringChangesSchema, recurringThisMonthSchema } from "./forecast";

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

describe("FLOW-415 recurring reads (decision 0172)", () => {
  it("reads missing_bills' names, last amount and source", () => {
    const [row] = missingBillsSchema.parse([
      {
        supplier_id: "s", supplier_name: "ספק לדוגמה", currency: "ILS", typical_amount_minor: -48_000, typical_day: 2,
        expected_by: "2026-10-07", months_seen: 4, last_doc_date: "2026-09-02", last_amount_minor: -47_500,
        project_id: "p", project_name: "פרויקט לדוגמה", category_id: "c", category_name: "מים", source: "user",
      },
    ]);
    expect(row?.last_amount_minor).toBe(-47_500n);
    expect([row?.project_name, row?.category_name, row?.source]).toEqual(["פרויקט לדוגמה", "מים", "user"]);
  });

  it("reads recurring_changes with a signed percent, and null as no rows", () => {
    expect(recurringChangesSchema.parse(null)).toEqual([]);
    const [row] = recurringChangesSchema.parse([
      {
        supplier_id: "s", supplier_name: null, currency: "ILS", amount_minor: -255_000, typical_amount_minor: -185_000,
        change_percent: 38, typical_day: 4, transaction_id: "t", project_id: null, project_name: null,
        category_id: "c", category_name: "חשמל", source: "auto",
      },
    ]);
    expect(row?.amount_minor).toBe(-255_000n);
    expect(row?.change_percent).toBe(38);
    expect(row?.supplier_name).toBe("");
  });

  it("reads an income row with no supplier, its pace and alert key (decision 0175)", () => {
    const [late] = missingBillsSchema.parse([
      {
        direction: "income", party_id: "c1", party_name: "שוכר לדוגמה", supplier_id: null, supplier_name: null,
        currency: "ILS", typical_amount_minor: 650000, typical_day: 5, expected_by: "2026-10-10", months_seen: 8,
        pace: "quarter", pace_source: "user", due_month: "2026-10", alert_key: "income:c1:ILS:2026-10",
      },
    ]);
    expect(late).toMatchObject({ direction: "income", supplier_id: null, party_name: "שוכר לדוגמה", pace: "quarter", due_month: "2026-10" });
    const [arrived] = recurringThisMonthSchema.parse([
      {
        direction: "expense", party_id: "s1", party_name: "אור חשמל", supplier_id: "s1", supplier_name: "אור חשמל", currency: "ILS",
        amount_minor: -132000, typical_amount_minor: -130000, change_percent: 2, changed: false, transaction_id: "t1", pace: "2months", alert_key: "t1",
      },
    ]);
    expect(arrived?.changed).toBe(false);
    expect(arrived?.amount_minor).toBe(-132000n);
    expect(() => missingBillsSchema.parse([{ ...late, typical_amount_minor: 1, pace: "weekly" }])).toThrow();
  });

  it("reads payment_recurring, with and without a party", () => {
    const none = paymentRecurringSchema.parse({ transaction_id: "t", party: null, recurring: false, override: null, detected: false, typical_day: null, typical_amount_minor: null });
    expect(none.party).toBeNull();
    const set = paymentRecurringSchema.parse({
      transaction_id: "t", party: { direction: "expense", id: "s", name: "ספק", currency: "ILS" },
      recurring: true, override: true, detected: false, typical_day: 4, typical_amount_minor: -185_000, prior_override: null,
    });
    expect(set.typical_amount_minor).toBe(-185_000n);
    expect(set.prior_override).toBeNull();
  });
});
