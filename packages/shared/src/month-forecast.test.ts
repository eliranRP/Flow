import { describe, expect, it } from "vitest";
import type { UnpaidRow } from "./dashboard";
import type { ExpectedMonths } from "./forecast";
import { buildMonthForecast, forecastTotal, type MonthForecastEdit, parseMonthEdits, SMALL_CHARGE_MINOR } from "./month-forecast";

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

  it("without payment terms (live data) guesses no date and marks nothing late", () => {
    const build = buildMonthForecast({ base: "ILS", expected, unpaid, overrides: [] });
    expect(build.items.every((item) => item.expected_on === null && item.late_days === 0)).toBe(true);
  });

  it("with payment terms (sample data) expects the date and counts the late days", () => {
    const build = buildMonthForecast({ base: "ILS", expected, unpaid, overrides: [], paymentTermsDays: 30 });
    const rent = build.items.find((item) => item.key === "party:expense:p-rent:ILS");
    expect(rent?.expected_on).toBe("2026-10-01");
    expect(rent?.late_days).toBe(15);
    const invoice = build.items.find((item) => item.kind === "invoice");
    expect(invoice?.expected_on).toBe(new Date(Date.parse(`${unpaid[0]?.doc_date ?? ""}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10));
  });

  it("gives each item its category: the recurring charge's usual one, the invoice's own, else null", () => {
    const withCategories = { ...expected, recurring: expected.recurring.map((party) => party.party_id === "p-rent" ? { ...party, category_id: "cat-rent" } : party) };
    const filed: UnpaidRow[] = [{ ...unpaid[0], category_id: "cat-clients" } as UnpaidRow];
    const build = buildMonthForecast({ base: "ILS", expected: withCategories, unpaid: filed, overrides: [] });
    expect(build.items.find((item) => item.key === "party:expense:p-rent:ILS")?.category_id).toBe("cat-rent");
    expect(build.items.find((item) => item.key === "invoice:inv-1")?.category_id).toBe("cat-clients");
    expect(build.items.find((item) => item.key === "party:expense:p-tea:ILS")?.category_id).toBeNull();
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

  it("counts a supplier invoice as expense and a customer invoice as income", () => {
    const supplier: UnpaidRow = { id: "bill-1", description: "Bill 1", doc_date: "2026-10-04", project_name: null, customer_name: "Supplier B", open_gross_agorot: -420000n, open_net_agorot: -420000n, currency: "ILS", direction: "expense" };
    const customer = unpaid.find((row) => row.id === "inv-1");
    if (customer == null) throw new Error("fixture");
    const build = buildMonthForecast({ base: "ILS", expected: { ...expected, recurring: [] }, unpaid: [customer, supplier], overrides: [] });
    expect(build.income.map((item) => item.key)).toEqual(["invoice:inv-1"]);
    expect(build.expense.map((item) => item.key)).toEqual(["invoice:bill-1"]);
    expect(build.expenseTotal).toBe(420000n);
  });
});

describe("buildMonthForecast: a party split by project (decision 0185)", () => {
  const split = {
    ...expected,
    recurring: [
      ...expected.recurring,
      { direction: "expense", party_id: "p-servicer", name: "Example Servicing", currency: "ILS", typical_amount_minor: -400000n, typical_day: 1, months_seen: 6, seen_this_month: false, project_id: "a" },
      { direction: "expense", party_id: "p-servicer", name: "Example Servicing", currency: "ILS", typical_amount_minor: -250000n, typical_day: 2, months_seen: 6, seen_this_month: false, project_id: "b" },
    ],
  } as unknown as ExpectedMonths;

  it("keys each of the party's charges by its project, and leaves one-charge parties' keys alone", () => {
    const build = buildMonthForecast({ base: "ILS", expected: split, unpaid: [], overrides: [] });
    const keys = build.items.map((item) => item.key);
    expect(keys).toContain("party:expense:p-servicer:ILS:a");
    expect(keys).toContain("party:expense:p-servicer:ILS:b");
    expect(keys).toContain("party:expense:p-rent:ILS");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries each charge's project, and an invoice's project name, for the item's page", () => {
    const withProject = { ...unpaid[0], project_name: "Example Lane" } as UnpaidRow;
    const build = buildMonthForecast({ base: "ILS", expected: split, unpaid: [withProject], overrides: [] });
    const charge = build.items.find((item) => item.key.endsWith(":a"));
    expect(charge?.project_id).toBe("a");
    expect(charge?.project_name).toBeNull();
    const invoice = build.items.find((item) => item.key === "invoice:inv-1");
    expect(invoice?.project_id).toBeNull();
    expect(invoice?.project_name).toBe("Example Lane");
  });

  it("applies an override to the one charge it names", () => {
    const build = buildMonthForecast({
      base: "ILS",
      expected: split,
      unpaid: [],
      overrides: [{ item_key: "party:expense:p-servicer:ILS:b", amount_minor: 260000n, due_on: null, moved_out: false }] as never,
    });
    expect(build.items.find((item) => item.key.endsWith(":b"))?.minor).toBe(260000n);
    expect(build.items.find((item) => item.key.endsWith(":a"))?.minor).toBe(400000n);
  });
});

describe("buildMonthForecast: only the charges due this month (decision 0199)", () => {
  // Today is 2026-10-16, so this month is October.
  function withParties(parties: Partial<ExpectedMonths["recurring"][number]>[]): ExpectedMonths {
    return {
      ...expected,
      recurring: parties.map((party, index) => ({
        direction: "expense",
        party_id: `p-${String(index)}`,
        name: `Example ${String(index)}`,
        currency: "ILS",
        typical_amount_minor: -40000n,
        typical_day: 12,
        months_seen: 2,
        seen_this_month: false,
        ...party,
      })),
    } as unknown as ExpectedMonths;
  }
  const names = (build: ReturnType<typeof buildMonthForecast>) => build.items.map((item) => item.name).sort();

  it("leaves out a yearly charge due in a later month, from the list and the totals", () => {
    const build = buildMonthForecast({ base: "ILS", expected: withParties([{ name: "Yearly Plan", pace: "year", next_due_month: "2027-07" }]), unpaid: [], overrides: [] });
    expect(build.items).toEqual([]);
    expect(build.expenseTotal).toBe(0n);
  });

  it("lists a yearly charge due this month, with its yearly amount", () => {
    const build = buildMonthForecast({ base: "ILS", expected: withParties([{ name: "Yearly Plan", pace: "year", next_due_month: "2026-10", typical_amount_minor: -44000n }]), unpaid: [], overrides: [] });
    expect(names(build)).toEqual(["Yearly Plan"]);
    expect(build.expenseTotal).toBe(44000n);
  });

  it("lists a late yearly charge (due in an earlier month) as due this month", () => {
    const build = buildMonthForecast({ base: "ILS", expected: withParties([{ name: "Late Yearly", pace: "year", next_due_month: "2026-08" }]), unpaid: [], overrides: [] });
    expect(names(build)).toEqual(["Late Yearly"]);
  });

  it("lists a quarterly charge only in its cycle's months", () => {
    const quarterly = (today: string, due: string) =>
      names(buildMonthForecast({ base: "ILS", expected: { ...withParties([{ name: "Quarterly", pace: "quarter", next_due_month: due }]), today }, unpaid: [], overrides: [] }));
    expect(quarterly("2026-10-16", "2026-10")).toEqual(["Quarterly"]);
    expect(quarterly("2026-10-16", "2026-11")).toEqual([]);
    expect(quarterly("2026-10-16", "2027-01")).toEqual([]);
    expect(quarterly("2027-01-05", "2027-01")).toEqual(["Quarterly"]);
  });

  it("keeps a monthly charge as before, a payload with no pace included", () => {
    const build = buildMonthForecast({
      base: "ILS",
      expected: withParties([{ name: "Monthly", pace: "month", next_due_month: "2026-10" }, { name: "No Pace" }, { name: "Paid", pace: "month", next_due_month: "2026-11", seen_this_month: true }]),
      unpaid: [],
      overrides: [],
    });
    expect(names(build)).toEqual(["Monthly", "No Pace"]);
  });

  describe("FLOW-1005: the project forecast edits of the month", () => {
    const onProject = {
      ...expected,
      recurring: expected.recurring.map((party) => (party.party_id === "p-rent" ? { ...party, project_id: "pj-1" } : party)),
    } as ExpectedMonths;
    const edit = (patch: Partial<MonthForecastEdit>): MonthForecastEdit => ({
      id: "e-1", project_id: "pj-1", kind: "add", row_key: null, category_id: "c-refund", category_name: "Utility refund",
      direction: "income", amount_minor: 17176, start_month: "2026-10", matched_transaction_id: null, ...patch,
    });

    it("counts a line the owner added, under its project, until its bank line comes", () => {
      const build = buildMonthForecast({ base: "ILS", expected: onProject, unpaid, overrides: [], edits: [edit({})] });
      const added = build.income.find((item) => item.key === "added:e-1");
      expect([added?.kind, added?.name, added?.minor, added?.project_id]).toEqual(["added", "Utility refund", 17176n, "pj-1"]);
      expect(build.incomeTotal).toBe(800000n + 250000n + 17176n);
      const arrived = buildMonthForecast({ base: "ILS", expected: onProject, unpaid, overrides: [], edits: [edit({ matched_transaction_id: "t-1" })] });
      expect(arrived.items.some((item) => item.key === "added:e-1")).toBe(false);
    });

    it("leaves out a line the owner took out again, and uses a changed amount of it", () => {
      const out = buildMonthForecast({ base: "ILS", expected: onProject, unpaid, overrides: [], edits: [edit({}), edit({ id: "e-2", kind: "remove", row_key: "add:e-1", category_id: null, direction: null, amount_minor: null })] });
      expect(out.items.some((item) => item.key === "added:e-1")).toBe(false);
      const changed = buildMonthForecast({ base: "ILS", expected: onProject, unpaid, overrides: [], edits: [edit({}), edit({ id: "e-3", kind: "change", row_key: "add:e-1", category_id: null, direction: null, amount_minor: 20000 })] });
      expect(changed.items.find((item) => item.key === "added:e-1")?.minor).toBe(20000n);
    });

    it("drops a recurring charge removed on its project's forecast, and uses a changed amount", () => {
      const removal = edit({ kind: "remove", row_key: "rec:expense:p-rent", category_id: null, direction: null, amount_minor: null });
      const gone = buildMonthForecast({ base: "ILS", expected: onProject, unpaid, overrides: [], edits: [removal] });
      expect(gone.items.some((item) => item.name === "Rent Co")).toBe(false);
      expect(gone.expenseTotal).toBe(3000n);
      const change = edit({ kind: "change", row_key: "rec:expense:p-rent", category_id: null, direction: null, amount_minor: 450000 });
      const rent = buildMonthForecast({ base: "ILS", expected: onProject, unpaid, overrides: [], edits: [change] }).expense.find((item) => item.name === "Rent Co");
      expect([rent?.usual, rent?.minor, rent?.overridden]).toEqual([450000n, 450000n, false]);
      // Another project's edit of the same party does not touch it.
      const elsewhere = buildMonthForecast({ base: "ILS", expected: onProject, unpaid, overrides: [], edits: [{ ...removal, project_id: "pj-2" }] });
      expect(elsewhere.items.some((item) => item.name === "Rent Co")).toBe(true);
    });

    it("gives a charge with no project the overhead project's edits", () => {
      const removal = edit({ project_id: "office", kind: "remove", row_key: "rec:income:p-retainer", category_id: null, direction: null, amount_minor: null });
      expect(buildMonthForecast({ base: "ILS", expected, unpaid, overrides: [], edits: [removal], overheadProjectId: "office" }).items.some((item) => item.name === "Retainer")).toBe(false);
      expect(buildMonthForecast({ base: "ILS", expected, unpaid, overrides: [], edits: [removal] }).items.some((item) => item.name === "Retainer")).toBe(true);
    });

    it("lets the month's own override still win over the project's amount", () => {
      const change = edit({ kind: "change", row_key: "rec:expense:p-rent", category_id: null, direction: null, amount_minor: 450000 });
      const build = buildMonthForecast({ base: "ILS", expected: onProject, unpaid, overrides: [{ item_key: "party:expense:p-rent:ILS", amount_minor: 400000, due_on: null, moved_out: false }], edits: [change] });
      expect(build.expense.find((item) => item.name === "Rent Co")?.minor).toBe(400000n);
    });
  });
});

describe("parseMonthEdits (FLOW-1005)", () => {
  it("reads the edits and the overhead project, leaving out a row without the shape", () => {
    const parsed = parseMonthEdits({
      overhead_project_id: "office",
      edits: [
        { id: "e-1", project_id: "pj-1", kind: "add", row_key: null, category_id: "c", category_name: "Refund", direction: "income", amount_minor: 100, start_month: "2026-11", matched_transaction_id: null },
        { id: "e-2", project_id: "pj-1", kind: "weird", start_month: "2026-11" },
        "not a row",
      ],
    });
    expect(parsed.overheadProjectId).toBe("office");
    expect(parsed.edits.map((edit) => edit.id)).toEqual(["e-1"]);
  });

  it("reads a body with no edits list as none, so the month's own items still show", () => {
    expect(parseMonthEdits(null)).toEqual({ overheadProjectId: null, edits: [] });
    expect(parseMonthEdits([])).toEqual({ overheadProjectId: null, edits: [] });
  });
});
