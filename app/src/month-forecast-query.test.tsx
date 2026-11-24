import { buildMonthForecast, type ExpectedMonths, type ForecastBuild, type ForecastItem, type UnpaidRow } from "@flow/shared";
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { monthForecastOf, useMonthForecastQuery } from "./month-forecast-query";
import { renderWithProviders } from "./test-render";
import { israelToday } from "./ui/date-math";

// FLOW-1314: Home's forecast row and the Forecast screen read month_forecast in one request, and the answer becomes what
// buildMonthForecast returns for the five old reads. Invented names and amounts only.
const rpc = vi.hoisted((): { calls: Array<{ name: string; args: unknown }>; answer: { data: unknown; error: { message: string } | null } } => ({
  calls: [],
  answer: { data: null, error: null },
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return Promise.resolve(rpc.answer);
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const today = israelToday();
const month = today.slice(0, 7);

/** A party the forecast counts: due this month, not seen yet. */
const party = (id: string, name: string, direction: "income" | "expense", amount: bigint, extra: Record<string, unknown> = {}) => ({
  direction, currency: "ILS", months_seen: 6, seen_this_month: false, typical_day: 5, party_id: id, name, typical_amount_minor: amount, ...extra,
});
const invoice = (id: string, name: string | null, description: string, gross: bigint, direction: "income" | "expense" = "income") => ({
  id, description, doc_date: `${month}-02`, project_name: null, customer_name: name, open_gross_agorot: gross, open_net_agorot: gross, currency: "ILS", direction,
});

// Two names that tie on amount and sort differently by code point and by Hebrew collation: a final letter (ך) is
// its plain letter (כ) in ICU, but 05DA comes before 05DB by code point. "כא" comes before "ךב" in Hebrew order only.
const TIE_FIRST = "כא";
const TIE_SECOND = "ךב";

const expected = {
  today,
  project_id: null,
  months: [],
  recurring: [
    party("p-rent", "Rent Co", "expense", -500_000n, { project_id: "pj-1" }),
    party("p-tie-2", TIE_SECOND, "expense", -20_000n),
    party("p-tie-1", TIE_FIRST, "expense", -20_000n),
    party("p-tea", "Tea Shop", "expense", -3_000n),
    party("p-seen", "Already Paid", "expense", -90_000n, { seen_this_month: true }),
    party("p-retainer", "Retainer", "income", 800_000n),
    party("p-other", "Dollar Co", "expense", -10_000n, { currency: "USD" }),
  ],
} as unknown as ExpectedMonths;
const unpaid = [
  invoice("inv-1", "Client A", "Invoice 1", 250_000n),
  invoice("inv-2", null, "Invoice 2", 20_000n),
  invoice("inv-3", "Supplier B", "Bill 3", 40_000n, "expense"),
] as unknown as UnpaidRow[];
const overrides = [
  { item_key: "invoice:inv-1", amount_minor: 200_000, due_on: `${month}-20`, moved_out: false },
  { item_key: "party:expense:p-rent:ILS", amount_minor: null, due_on: null, moved_out: true },
];
const edits = [
  { id: "e-1", project_id: "pj-1", kind: "add" as const, row_key: null, category_id: "c-1", category_name: "Refund", direction: "income" as const, amount_minor: 10_000, pace: "once", start_month: month, matched_transaction_id: null },
];

/** What the five old reads built. */
const reference = buildMonthForecast({ base: "ILS", expected, unpaid, overrides, edits, overheadProjectId: null });

/** The database's answer for the same build: the build with each item cut as month_forecast cuts it, amounts as JSON numbers, and the lists in its own order (amount, then name by code point). */
function answerOf(build: ForecastBuild) {
  const wire = (item: ForecastItem) => {
    const { currency: _currency, expected_on: _expectedOn, late_days: _lateDays, ...rest } = item;
    return Object.fromEntries(Object.entries({ ...rest, usual: Number(item.usual), minor: Number(item.minor) }).filter(([, value]) => value !== null));
  };
  const byCodePoint = (a: ForecastItem, b: ForecastItem) => (a.minor !== b.minor ? (a.minor > b.minor ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const keys = (list: readonly ForecastItem[]) => [...list].sort(byCodePoint).map((item) => item.key);
  return {
    month,
    base: "ILS",
    overrides,
    build: {
      items: build.items.map(wire),
      income: keys(build.income),
      expense: keys(build.expense),
      moved: keys(build.moved),
      small: keys(build.small),
      incomeTotal: Number(build.incomeTotal),
      expenseTotal: Number(build.expenseTotal),
      changed: build.changed,
    },
  };
}

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.answer = { data: answerOf(reference), error: null };
});

describe("month_forecast's answer, as the screens read it (FLOW-1314)", () => {
  it("is exactly what buildMonthForecast returned from the five reads, restored item fields and re-sorted lists included", () => {
    // The fixture covers a moved item, an override, a small charge, an added line, a split-free party and a nameless customer.
    expect(reference.moved).toHaveLength(1);
    expect(reference.small).toHaveLength(1);
    expect(reference.items.some((item) => item.kind === "added")).toBe(true);
    expect(monthForecastOf(answerOf(reference))).toEqual({ month, base: "ILS", overrides, build: reference });
  });

  it("sorts equal amounts by the name in Hebrew order, not the database's code point order", () => {
    const answer = answerOf(reference);
    // The database lists the two ties the other way round: that is the order the app must not keep.
    const dbExpense = answer.build.expense;
    expect(dbExpense.indexOf("party:expense:p-tie-2:ILS")).toBeLessThan(dbExpense.indexOf("party:expense:p-tie-1:ILS"));
    const names = monthForecastOf(answer).build.expense.map((item) => item.name);
    expect(names.indexOf(TIE_FIRST)).toBeLessThan(names.indexOf(TIE_SECOND));
    expect(names).toEqual(reference.expense.map((item) => item.name));
  });

  it("restores what the database leaves out: currency from the base, no expected day, no lateness, an absent field as null", () => {
    const answer = {
      month,
      base: "USD",
      overrides: [],
      build: {
        items: [{ key: "party:expense:p-1:USD", direction: "expense", kind: "recurring", name: "Example Utility", usual: 25_000, minor: 25_000, moved_out: false, overridden: false }],
        income: [],
        expense: ["party:expense:p-1:USD"],
        moved: [],
        small: [],
        incomeTotal: 0,
        expenseTotal: 25_000,
        changed: 0,
      },
    };
    const [item] = monthForecastOf(answer).build.items;
    expect(item).toEqual({
      key: "party:expense:p-1:USD", direction: "expense", kind: "recurring", name: "Example Utility", currency: "USD",
      usual: 25_000n, minor: 25_000n, day: null, description: null, due_on: null, moved_out: false, overridden: false,
      expected_on: null, late_days: 0, category_id: null, project_id: null, project_name: null, pace: null, line_start: null,
    });
    expect(monthForecastOf(answer).build.expenseTotal).toBe(25_000n);
  });

  it("refuses an answer that is not the forecast, so the screen shows its failed state", () => {
    expect(() => monthForecastOf(null)).toThrow(/month_forecast/);
    expect(() => monthForecastOf({ month, base: "ILS", overrides: [], build: { items: [{ key: "k" }] } })).toThrow(/month_forecast/);
    const unsafe = answerOf(reference);
    expect(() => monthForecastOf({ ...unsafe, build: { ...unsafe.build, incomeTotal: 2 ** 60 } })).toThrow(/whole amount/);
  });
});

function Probe({ onData }: { onData: (data: unknown) => void }) {
  onData(useMonthForecastQuery(month).data);
  return null;
}

describe("the month forecast's read (FLOW-1314)", () => {
  it("is one request, month_forecast with the month and today's date, and no other forecast read", async () => {
    let data: unknown = null;
    const { client } = renderWithProviders(<Probe onData={(next) => { data = next; }} />, { route: "/" });
    await waitFor(() => { expect(data).not.toBeNull(); });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(rpc.calls).toEqual([{ name: "month_forecast", args: { p_month: month, p_today: today } }]);
    expect(data).toEqual({ month, base: "ILS", overrides, build: reference });
    // Under the key the kept rule names.
    expect(client.getQueryData(["month-forecast", "off", "answer", month])).toEqual(data);
  });

  it("fails the read when the database does, for the screens' failed state and retry", async () => {
    rpc.answer = { data: null, error: { message: "boom" } };
    let failed = false;
    function Failing() {
      failed = useMonthForecastQuery(month).isError;
      return null;
    }
    renderWithProviders(<Failing />, { route: "/" });
    await waitFor(() => { expect(failed).toBe(true); });
    expect(rpc.calls).toHaveLength(1);
  });
});
