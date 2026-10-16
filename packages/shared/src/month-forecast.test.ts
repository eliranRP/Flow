import { describe, expect, it } from "vitest";
import type { UnpaidRow } from "./dashboard";
import type { ExpectedMonths } from "./forecast";
import { buildMonthForecast, forecastTotal, SMALL_CHARGE_MINOR } from "./month-forecast";

const expected: ExpectedMonths = {
  today: "2026-10-16",
  project_id: null,
  months: [{ month: "2026-10", open: true, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: 0n }] }],
  recurring: [
    { direction: "expense", party_id: "p-rent", name: "Rent Co", currency: "ILS", typical_amount_minor: -500000n, typical_day: 1, months_seen: 6, seen_this_month: false },
    { direction: "expense", party_id: "p-tea", name: "Tea Shop", currency: "ILS", typical_amount_minor: -3000n, typical_day: 5, months_seen: 6, seen_this_month: false },
    { direction: "expense", party_id: "p-seen", name: "Already Paid", currency: "ILS", typical_amount_minor: -90000n, typical_day: 2, months_seen: 6, seen_this_month: true },
    { direction: "income", party_id: "p-retainer", name: "Retainer", currency: "ILS", typical_amount_minor: 800000n, typical_day: 10, months_seen: 4, seen_this_month: false },
  ],
} as unknown as ExpectedMonths;

const unpaid: UnpaidRow[] = [
  { id: "inv-1", description: "Invoice 1", doc_date: "2026-10-02", project_name: null, customer_name: "Client A", open_gross_agorot: 250000n, open_net_agorot: 250000n, currency: "ILS" },
  { id: "inv-2", description: "Invoice 2", doc_date: "2026-10-03", project_name: null, customer_name: null, open_gross_agorot: 0n, open_net_agorot: 0n, currency: "ILS" },
];

describe("buildMonthForecast", () => {
  it("lists the parties not yet seen and the open invoices, with the totals", () => {
    const build = buildMonthForecast({ base: "ILS", expected, unpaid, overrides: [] });
    expect(build.expense.map((item) => item.name)).toEqual(["Rent Co"]);
    expect(build.small.map((item) => item.name)).toEqual(["Tea Shop"]);
    expect(build.income.map((item) => item.name)).toEqual(["Retainer", "Client A"]);
    expect(build.incomeTotal).toBe(800000n + 250000n);
    expect(build.expenseTotal).toBe(500000n + 3000n);
    expect(build.changed).toBe(0);
  });

  it("uses the same total as Home's line: the cash net plus income minus charges", () => {
    const build = buildMonthForecast({ base: "ILS", expected, unpaid, overrides: [] });
    expect(forecastTotal(100000n, build)).toBe(100000n + 1050000n - 503000n);
  });

  it("applies an amount override and keeps the row's own number", () => {
    const build = buildMonthForecast({
      base: "ILS",
      expected,
      unpaid,
      overrides: [{ item_key: "party:expense:p-rent:ILS", amount_minor: 480000, due_on: null, moved_out: false }],
    });
    const rent = build.items.find((item) => item.key === "party:expense:p-rent:ILS");
    expect(rent?.minor).toBe(480000n);
    expect(rent?.usual).toBe(500000n);
    expect(rent?.overridden).toBe(true);
    expect(build.changed).toBe(1);
    expect(build.expenseTotal).toBe(480000n + 3000n);
  });

  it("moves an item out of the totals into the moved list, and a reset brings it back", () => {
    const moved = buildMonthForecast({
      base: "ILS",
      expected,
      unpaid,
      overrides: [{ item_key: "invoice:inv-1", amount_minor: null, due_on: null, moved_out: true }],
    });
    expect(moved.moved.map((item) => item.name)).toEqual(["Client A"]);
    expect(moved.incomeTotal).toBe(800000n);
    const back = buildMonthForecast({ base: "ILS", expected, unpaid, overrides: [] });
    expect(back.incomeTotal).toBe(1050000n);
    expect(back.moved).toHaveLength(0);
  });

  it("groups charges under the small threshold and keeps the big ones in their own list", () => {
    const build = buildMonthForecast({ base: "ILS", expected, unpaid: [], overrides: [] });
    expect(build.small.every((item) => item.minor < SMALL_CHARGE_MINOR)).toBe(true);
    expect(build.expense.every((item) => item.minor >= SMALL_CHARGE_MINOR)).toBe(true);
  });

  it("ignores items in another currency", () => {
    const build = buildMonthForecast({ base: "USD", expected, unpaid, overrides: [] });
    expect(build.items).toHaveLength(0);
    expect(forecastTotal(0n, build)).toBe(0n);
  });
});
