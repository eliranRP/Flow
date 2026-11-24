// Flow MCP tools tests: the month-end forecast (FLOW-141, FLOW-1312). get_forecast reads month_forecast (the database
// builds the forecast) and the month's cash net, and answers what it answered when it built the forecast from four reads;
// get_company_forecast reads company_forecast; set_forecast_item and reset_forecast forward to their RPCs.
import { assertEquals } from "jsr:@std/assert@1";
import { z } from "zod";
import { unpaidRowSchema } from "../../../packages/shared/src/dashboard.ts";
import { expectedMonthsSchema } from "../../../packages/shared/src/forecast.ts";
import { forecastLastMonth, forecastMonths } from "../../../packages/shared/src/forecast-horizon.ts";
import { buildMonthForecast, type ForecastBuild, type ForecastItem } from "../../../packages/shared/src/month-forecast.ts";
import { callTool, toolsFor } from "./tools.ts";
import { buildOfAnswer } from "./tools_forecast_read.ts";
import { forecastReportOf, israelMonthKey } from "./tools_reports.ts";
import { rpcOf } from "./tools_test_support.ts";
import v0 from "../../../packages/shared/fixtures/vectors/month-forecast/amount-near-2-pow-53.json" with { type: "json" };
import v1 from "../../../packages/shared/fixtures/vectors/month-forecast/amount-override-keeps-usual.json" with { type: "json" };
import v2 from "../../../packages/shared/fixtures/vectors/month-forecast/category-of-each-item.json" with { type: "json" };
import v3 from "../../../packages/shared/fixtures/vectors/month-forecast/due-on-override.json" with { type: "json" };
import v4 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-add-line-matched.json" with { type: "json" };
import v5 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-add-line.json" with { type: "json" };
import v6 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-add-zero-amount-is-out.json" with { type: "json" };
import v7 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-change-added-line.json" with { type: "json" };
import v8 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-change-recurring-charge.json" with { type: "json" };
import v9 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-latest-change-wins.json" with { type: "json" };
import v10 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-no-overhead-project-is-ignored.json" with { type: "json" };
import v11 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-on-another-project-is-ignored.json" with { type: "json" };
import v12 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-overhead-project-removal.json" with { type: "json" };
import v13 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-remove-added-line.json" with { type: "json" };
import v14 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-remove-recurring-charge.json" with { type: "json" };
import v15 from "../../../packages/shared/fixtures/vectors/month-forecast/ended-charge-before-its-day-is-out.json" with { type: "json" };
import v16 from "../../../packages/shared/fixtures/vectors/month-forecast/ended-charge-long-ago-is-out.json" with { type: "json" };
import v17 from "../../../packages/shared/fixtures/vectors/month-forecast/handover-leaves-the-charge-out.json" with { type: "json" };
import v18 from "../../../packages/shared/fixtures/vectors/month-forecast/lists-parties-and-open-invoices.json" with { type: "json" };
import v19 from "../../../packages/shared/fixtures/vectors/month-forecast/monthly-no-pace-and-paid.json" with { type: "json" };
import v20 from "../../../packages/shared/fixtures/vectors/month-forecast/moved-out-override.json" with { type: "json" };
import v21 from "../../../packages/shared/fixtures/vectors/month-forecast/null-handover-counts-as-before.json" with { type: "json" };
import v22 from "../../../packages/shared/fixtures/vectors/month-forecast/other-currency-is-ignored.json" with { type: "json" };
import v23 from "../../../packages/shared/fixtures/vectors/month-forecast/override-wins-over-edit.json" with { type: "json" };
import v24 from "../../../packages/shared/fixtures/vectors/month-forecast/quarter-charge-in-its-month-next-year.json" with { type: "json" };
import v25 from "../../../packages/shared/fixtures/vectors/month-forecast/quarter-charge-in-its-month.json" with { type: "json" };
import v26 from "../../../packages/shared/fixtures/vectors/month-forecast/quarter-charge-next-month-is-out.json" with { type: "json" };
import v27 from "../../../packages/shared/fixtures/vectors/month-forecast/quarter-charge-three-months-on-is-out.json" with { type: "json" };
import v28 from "../../../packages/shared/fixtures/vectors/month-forecast/small-charge-threshold.json" with { type: "json" };
import v29 from "../../../packages/shared/fixtures/vectors/month-forecast/split-party-invoice-project-name.json" with { type: "json" };
import v30 from "../../../packages/shared/fixtures/vectors/month-forecast/split-party-keys-by-project.json" with { type: "json" };
import v31 from "../../../packages/shared/fixtures/vectors/month-forecast/split-party-override-one-charge.json" with { type: "json" };
import v32 from "../../../packages/shared/fixtures/vectors/month-forecast/supplier-invoice-is-expense.json" with { type: "json" };
import v33 from "../../../packages/shared/fixtures/vectors/month-forecast/yearly-charge-due-later-is-out.json" with { type: "json" };
import v34 from "../../../packages/shared/fixtures/vectors/month-forecast/yearly-charge-due-this-month.json" with { type: "json" };
import v35 from "../../../packages/shared/fixtures/vectors/month-forecast/yearly-charge-late-counts.json" with { type: "json" };

// The shared month-forecast vectors (packages/shared/fixtures/vectors/month-forecast) as static JSON imports: these tests run with
// --allow-env only, and a computed import path needs --allow-read. The vector with payment terms is left out (month_forecast
// sets none: sample data only). Add a new vector's import and name here. They live in this test file, never in a module the
// function imports: check-prod-bundle.mjs scans every other file here for "fixtures/", and the deploy bundles only what index.ts imports.
type MonthForecastVector = {
  name: string;
  input: { base: string; expected: { today: string; recurring: Record<string, unknown>[] }; unpaid: Record<string, unknown>[]; overrides: unknown[] };
  expected: { items: Record<string, unknown>[]; income: string[]; expense: string[]; moved: string[]; small: string[]; incomeTotal: number; expenseTotal: number; changed: number };
};
const MONTH_FORECAST_VECTORS = [v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35] as unknown as MonthForecastVector[];

const KEY = "11111111-2222-4333-8444-555555555555";

const expected = {
  today: "2026-10-16",
  project_id: null,
  months: [{ month: "2026-10", open: true, by_currency: [{ currency: "ILS", income_minor: 250000, expense_minor: -500000 }] }],
  recurring: [
    { direction: "expense", party_id: "p-rent", name: "Rent Co", currency: "ILS", typical_amount_minor: -500000, typical_day: 1, months_seen: 6, seen_this_month: false, category_id: "c-rent" },
  ],
};
const unpaid = [
  { id: "inv-1", description: "Invoice 1", doc_date: "2026-10-02", project_name: null, customer_name: "Client A", open_gross_agorot: 250000, open_net_agorot: 250000, currency: "ILS" },
];
const overrides = [{ item_key: "party:expense:p-rent:ILS", amount_minor: 480000, due_on: null, moved_out: false }];
const noEdits = { month: "2026-10", overhead_project_id: null, edits: [] };

type Fixture = { expected: unknown; unpaid: unknown; overrides: unknown[]; edits: unknown; base: string };
const fixture: Fixture = { expected, unpaid, overrides, edits: noEdits, base: "ILS" };

/** An item as month_forecast leaves it: no currency (the base), expected_on, late_days, and no null field (absent = null). */
function stripped(item: ForecastItem): Record<string, unknown> {
  const wire: Record<string, unknown> = { ...item, usual: Number(item.usual), minor: Number(item.minor) };
  delete wire.currency;
  delete wire.expected_on;
  delete wire.late_days;
  return Object.fromEntries(Object.entries(wire).filter(([, value]) => value !== null));
}

/** What month_forecast answers for a build: the lists as item keys, in the reverse of the builder's order (the tool sorts them itself). */
function answerOf(month: string, base: string, build: ForecastBuild, overridesRows: unknown[]) {
  const keys = (list: ForecastItem[]) => list.map((item) => item.key).reverse();
  return {
    month,
    base,
    overrides: overridesRows,
    build: {
      items: build.items.map(stripped),
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

function forecastOf(f: Fixture, month: string) {
  const build = buildMonthForecast({
    base: f.base,
    expected: expectedMonthsSchema.parse(f.expected),
    unpaid: z.array(unpaidRowSchema).parse(f.unpaid),
    overrides: f.overrides as never,
    edits: (f.edits as { edits: never[] }).edits,
    overheadProjectId: (f.edits as { overhead_project_id: string | null }).overhead_project_id,
  });
  return answerOf(month, f.base, build, f.overrides);
}

const cash = { status: 200, json: { basis: "cash", base_currency: "ILS", months: [{ month: "2026-10-01", by_currency: [{ currency: "ILS", net_minor: 120000 }] }] } };

function readsOf(f: Fixture) {
  return (name: string, body: Record<string, unknown>) => {
    if (name === "month_forecast") return { status: 200, json: forecastOf(f, String(body.p_month)) };
    if (name === "cash_months") return cash;
    return { status: 500, json: null };
  };
}
const reads = readsOf(fixture);

type Data = Record<string, unknown> & {
  month: string;
  income_total_minor: number;
  expense_total_minor: number;
  changed: number;
  cash_net_minor: number | null;
  big_number_minor: number | null;
  income: { key: string; kind: string; minor: number }[];
  expense: { minor: number; usual_minor: number; category_id: string | null }[];
  small: { count: number };
};
const dataOf = (result: { structuredContent: { ok: boolean; data?: unknown } }) => (result.structuredContent.ok ? result.structuredContent.data : null) as Data | null;

Deno.test("get_forecast reads month_forecast and the cash net, and answers the items, totals and changed count", async () => {
  const { calls, rpc } = rpcOf(reads);
  const result = await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc);
  assertEquals(result.isError, false);
  const data = dataOf(result);
  assertEquals(data?.month, "2026-10");
  assertEquals(data?.income_total_minor, 250000);
  assertEquals(data?.expense_total_minor, 480000);
  assertEquals(data?.changed, 1);
  assertEquals(data?.expense[0]?.minor, 480000);
  assertEquals(data?.expense[0]?.usual_minor, 500000);
  // לפי קטגוריה groups the items by their category.
  assertEquals(data?.expense[0]?.category_id, "c-rent");
  // Four reads became one; the cash net is still the cash read's.
  assertEquals(calls.map((call) => call.name).sort(), ["cash_months", "month_forecast"]);
  // Home's number: the cash net + the income still to come - the charges still to go (small ones included).
  assertEquals(data?.cash_net_minor, 120000);
  assertEquals(data?.big_number_minor, 120000 + 250000 - 480000);
  assertEquals(calls.find((call) => call.name === "month_forecast")?.body, { p_month: "2026-10", p_today: null });
});

Deno.test("get_forecast passes its today as p_today, and a month left out is today's month", async () => {
  const { calls, rpc } = rpcOf(reads);
  await callTool("get_forecast", { month: "2026-10", today: "2026-10-16" }, ["read"], rpc);
  assertEquals(calls.find((call) => call.name === "month_forecast")?.body, { p_month: "2026-10", p_today: "2026-10-16" });
  const alone = rpcOf(reads);
  await callTool("get_forecast", { today: "2026-10-16" }, ["read"], alone.rpc);
  assertEquals(alone.calls.find((call) => call.name === "month_forecast")?.body, { p_month: "2026-10", p_today: "2026-10-16" });
  const bad = rpcOf(reads);
  const refused = await callTool("get_forecast", { month: "2026-10", today: "2026-02-30" }, ["read"], bad.rpc);
  assertEquals(refused.structuredContent, { ok: false, error: { code: "validation", message: "validation" } });
  assertEquals(bad.calls.length, 0);
});

Deno.test("get_forecast counts the projects' forecast edits of the month (FLOW-1005)", async () => {
  const edits = {
    month: "2026-10",
    overhead_project_id: "office",
    edits: [
      { id: "e-1", project_id: "pj-1", kind: "add", row_key: null, category_id: "c-refund", category_name: "Utility refund", direction: "income", amount_minor: 17176, pace: "month", start_month: "2026-10", matched_transaction_id: null },
      { id: "e-2", project_id: "office", kind: "remove", row_key: "rec:expense:p-rent", category_id: null, category_name: null, direction: null, amount_minor: null, pace: "month", start_month: "2026-10" },
    ],
  };
  const { rpc } = rpcOf(readsOf({ ...fixture, edits }));
  const data = dataOf(await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc));
  assertEquals(data?.income.find((item) => item.key === "added:e-1")?.kind, "added");
  assertEquals(data?.income_total_minor, 250000 + 17176);
  // Rent Co has no project: the overhead project's removal takes it out.
  assertEquals(data?.expense_total_minor, 0);
});

Deno.test("get_forecast counts a dollar company's items and cash in dollars", async () => {
  const usd = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll('"ILS"', '"USD"').replaceAll(":ILS", ":USD"));
  const dollars: Fixture = { ...fixture, base: "USD", expected: usd(expected), unpaid: usd(unpaid), overrides: usd(overrides) };
  const { rpc } = rpcOf((name, body) => name === "cash_months" ? { status: 200, json: usd(cash.json) } : readsOf(dollars)(name, body));
  const data = dataOf(await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc));
  assertEquals(data?.base_currency, "USD");
  assertEquals(data?.income_total_minor, 250000);
  assertEquals(data?.expense_total_minor, 480000);
  assertEquals(data?.cash_net_minor, 120000);
  assertEquals((data?.expense as unknown as { currency: string }[])[0]?.currency, "USD");
});

Deno.test("get_forecast lists a yearly charge only in its due month (decision 0199)", async () => {
  const yearly = (due: string) => ({ direction: "expense", party_id: "p-plan", name: "Plan Co", currency: "ILS", typical_amount_minor: -44000, typical_day: 12, months_seen: 2, seen_this_month: false, pace: "year", next_due_month: due });
  const read = async (due: string) => {
    const { rpc } = rpcOf(readsOf({ ...fixture, expected: { ...expected, recurring: [...expected.recurring, yearly(due)] } }));
    return dataOf(await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc));
  };
  const later = await read("2027-07");
  assertEquals([later?.expense_total_minor, later?.small.count], [480000, 0]);
  const due = await read("2026-10");
  assertEquals([due?.expense_total_minor, due?.small.count], [480000 + 44000, 0]);
});

Deno.test("get_forecast defaults to this month in Israel time and refuses a bad month before any read", async () => {
  const { calls, rpc } = rpcOf(reads);
  const bad = await callTool("get_forecast", { month: "2026-13" }, ["read"], rpc);
  assertEquals(bad.isError, true);
  assertEquals(calls.length, 0);
  assertEquals(/^\d{4}-\d{2}$/.test(israelMonthKey()), true);
  await callTool("get_forecast", {}, ["read"], rpc);
  assertEquals(calls.find((call) => call.name === "month_forecast")?.body, { p_month: israelMonthKey(), p_today: null });
});

Deno.test("get_forecast takes a month up to the forecast's last, and refuses a later one before any read (FLOW-1066)", async () => {
  const { calls, rpc } = rpcOf(reads);
  const last = forecastLastMonth(israelMonthKey());
  const ok = await callTool("get_forecast", { month: last }, ["read"], rpc);
  assertEquals(ok.isError, false);
  assertEquals(calls.find((call) => call.name === "month_forecast")?.body, { p_month: last, p_today: null });
  const count = calls.length;
  const refused = await callTool("get_forecast", { month: forecastMonths(last)[0] }, ["read"], rpc);
  assertEquals(refused.structuredContent, { ok: false, error: { code: "validation", message: "validation" } });
  assertEquals(calls.length, count);
});

Deno.test("get_forecast refuses when a read fails", async () => {
  for (const failing of ["month_forecast", "cash_months"]) {
    const { rpc } = rpcOf((name, body) => name === failing ? { status: 500, json: null } : reads(name, body));
    const result = await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc);
    assertEquals(result.structuredContent, { ok: false, error: { code: "refused", message: "The read was refused." } });
  }
});

Deno.test("get_forecast refuses an answer with no usable currency or a malformed build, never counting in shekels", async () => {
  const whole = forecastOf(fixture, "2026-10");
  for (const spoil of [{ base: "dollars" }, { base: undefined }, { build: null }, { build: { ...whole.build, items: "none" } }, { build: { ...whole.build, expense: [1] } }]) {
    const { rpc } = rpcOf((name, body) => name === "month_forecast" ? { status: 200, json: { ...whole, ...spoil } } : reads(name, body));
    assertEquals((await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc)).isError, true);
  }
});

// The shared vectors (packages/shared/fixtures/vectors/month-forecast, imported at the top): what month_forecast answers
// for each, read back by the tool, is the builder's own build (the app's FLOW-1314 mapper does the same), and the tool's
// answer is the one the builder gave.
Deno.test("get_forecast equals the builder's forecast for every shared month-forecast vector", async () => {
  // packages/shared/src/vectors.test.ts checks that this file imports every vector in the folder but the documented
  // exception (payment terms), so a new vector fails there until it is added.
  for (const vector of MONTH_FORECAST_VECTORS) {
    const { name } = vector;
    const { input } = vector;
    const month = input.expected.today.slice(0, 7);
    const build = buildMonthForecast({
      ...input,
      // As the tool read them before: the database's JSON through the schemas.
      expected: expectedMonthsSchema.parse(input.expected),
      unpaid: z.array(unpaidRowSchema).parse(input.unpaid),
      overrides: input.overrides as never,
    } as never);
    // The vector's expected IS the database build's figures: its items stripped as month_forecast strips them, its lists reversed.
    const stripItem = (item: Record<string, unknown>) => Object.fromEntries(Object.entries(item).filter(([key, value]) => value !== null && key !== "currency" && key !== "expected_on" && key !== "late_days"));
    const reversed = (keys: string[]) => [...keys].reverse();
    const answer = {
      month,
      base: input.base,
      overrides: input.overrides,
      build: { ...vector.expected, items: vector.expected.items.map(stripItem), income: reversed(vector.expected.income), expense: reversed(vector.expected.expense), moved: reversed(vector.expected.moved), small: reversed(vector.expected.small) },
    };
    assertEquals(buildOfAnswer(answer)?.build, build, `${name}: the build read back`);
    const { rpc } = rpcOf((rpcName) => rpcName === "month_forecast" ? { status: 200, json: answer } : cash);
    const result = await callTool("get_forecast", { month, today: input.expected.today }, ["read"], rpc);
    assertEquals(dataOf(result), JSON.parse(JSON.stringify(forecastReportOf(month, build, input.base, cash.json))), `${name}: the tool's answer`);
  }
});

const COMPANY_MONTHS = forecastMonths(israelMonthKey());

Deno.test("get_company_forecast is in the tool list, for a read scope only, with its months and detail documented", () => {
  const spec = toolsFor(["read"]).find((tool) => tool.name === "get_company_forecast");
  assertEquals(spec?.annotations.readOnlyHint, true);
  const schema = spec?.inputSchema as unknown as { properties: Record<string, { enum?: string[] }>; required: string[] };
  assertEquals(Object.keys(schema.properties), ["months", "detail", "today"]);
  assertEquals(schema.required, ["months"]);
  assertEquals(schema.properties.detail?.enum, ["totals", "rows"]);
  assertEquals(/ONE month only/.test(spec?.description ?? ""), true);
  assertEquals(toolsFor(["write"]).some((tool) => tool.name === "get_company_forecast"), false);
  // get_forecast takes today now.
  const forecast = toolsFor(["read"]).find((tool) => tool.name === "get_forecast");
  assertEquals(Object.keys((forecast?.inputSchema as unknown as { properties: object }).properties), ["month", "today"]);
});

Deno.test("get_company_forecast reads company_forecast and answers it as it is, totals by default", async () => {
  const vector = (await import("../../../packages/shared/fixtures/vectors/company-forecast/company-round-numbers.json", { with: { type: "json" } })).default as { expected: { months: unknown[] } };
  const answer = { today: "2026-10-11", currency: "USD", ...vector.expected };
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: answer }));
  const result = await callTool("get_company_forecast", { months: [COMPANY_MONTHS[0], COMPANY_MONTHS[3]] }, ["read"], rpc);
  assertEquals(result.structuredContent, { ok: true, data: answer });
  assertEquals(calls.map((call) => [call.name, call.body]), [["company_forecast", { p_months: [COMPANY_MONTHS[0], COMPANY_MONTHS[3]], p_detail: "totals", p_today: null }]]);
  const rows = rpcOf(() => ({ status: 200, json: answer }));
  await callTool("get_company_forecast", { months: [COMPANY_MONTHS[1]], detail: "rows", today: "2026-10-11" }, ["read"], rows.rpc);
  assertEquals(rows.calls[0]?.body, { p_months: [COMPANY_MONTHS[1]], p_detail: "rows", p_today: "2026-10-11" });
});

Deno.test("get_company_forecast refuses a bad month, a repeat, rows for several months or an odd field before any read", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { months: [] } }));
  const bad = [
    {},
    { months: [] },
    { months: "2026-12" },
    { months: ["2026-13"] },
    { months: [israelMonthKey()] },
    { months: [forecastMonths(forecastLastMonth(israelMonthKey()))[0]] },
    { months: [COMPANY_MONTHS[0], COMPANY_MONTHS[0]] },
    { months: [COMPANY_MONTHS[0], COMPANY_MONTHS[1]], detail: "rows" },
    { months: [COMPANY_MONTHS[0]], detail: "everything" },
    { months: [COMPANY_MONTHS[0]], today: "2026-02-30" },
    { months: [COMPANY_MONTHS[0]], colour: "red" },
  ];
  for (const input of bad) {
    const result = await callTool("get_company_forecast", input, ["read"], rpc);
    assertEquals([result.isError, result.structuredContent.ok ? null : result.structuredContent.error.code], [true, "validation"], JSON.stringify(input));
  }
  assertEquals(calls.length, 0);
  assertEquals((await callTool("get_company_forecast", { months: [COMPANY_MONTHS[11]] }, ["read"], rpc)).isError, false);
  // The horizon counts from today when it is given: a month that is next month then.
  assertEquals((await callTool("get_company_forecast", { months: ["2027-02"], today: "2027-01-05" }, ["read"], rpc)).isError, false);
  assertEquals((await callTool("get_company_forecast", { months: ["2027-01"], today: "2027-01-05" }, ["read"], rpc)).isError, true);
});

Deno.test("get_company_forecast maps the database's refusals: 22023 validation, 42501 forbidden, anything else refused", async () => {
  const refuse = async (status: number, json: unknown) => (await callTool("get_company_forecast", { months: [COMPANY_MONTHS[0]] }, ["read"], rpcOf(() => ({ status, json })).rpc)).structuredContent;
  assertEquals(await refuse(400, { code: "22023", message: "validation" }), { ok: false, error: { code: "validation", message: "validation" } });
  assertEquals(await refuse(403, { code: "42501", message: "no company" }), { ok: false, error: { code: "forbidden", message: "forbidden" } });
  assertEquals(await refuse(500, null), { ok: false, error: { code: "refused", message: "The read was refused." } });
  assertEquals(await refuse(200, { months: "none" }), { ok: false, error: { code: "refused", message: "The read was refused." } });
  assertEquals(await refuse(200, null), { ok: false, error: { code: "refused", message: "The read was refused." } });
});

Deno.test("set_forecast_item forwards the patch and refuses a reset with other fields", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "forecast_item" } } }));
  await callTool("set_forecast_item", { idempotency_key: "fc-1", month: "2026-10", item_key: "invoice:inv-1", moved_out: true }, ["write"], rpc);
  await callTool("set_forecast_item", { idempotency_key: "fc-2", month: "2026-10", item_key: "invoice:inv-1", reset: true }, ["write"], rpc);
  const bad = await callTool("set_forecast_item", { idempotency_key: "fc-3", month: "2026-10", item_key: "invoice:inv-1", reset: true, moved_out: true }, ["write"], rpc);
  const empty = await callTool("set_forecast_item", { idempotency_key: "fc-4", month: "2026-10", item_key: "invoice:inv-1" }, ["write"], rpc);
  const unknown = await callTool("set_forecast_item", { idempotency_key: "fc-5", month: "2026-10", item_key: "invoice:inv-1", colour: "red" }, ["write"], rpc);
  assertEquals([bad.isError, empty.isError, unknown.isError], [true, true, true]);
  assertEquals(calls.map((call) => call.name), ["mcp_set_forecast_item", "mcp_set_forecast_item"]);
  assertEquals(calls[0]?.body, {
    p_idempotency_key: "fc-1",
    p_month: "2026-10",
    p_item_key: "invoice:inv-1",
    p_patch: { moved_out: true },
  });
  assertEquals(calls[1]?.body.p_patch, { reset: true });
});

Deno.test("reset_forecast takes a month and is a write, and a read token cannot call it", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "forecast_reset" } } }));
  await callTool("reset_forecast", { idempotency_key: KEY, month: "2026-10" }, ["write"], rpc);
  assertEquals(calls[0]?.name, "mcp_reset_forecast");
  assertEquals(calls[0]?.body, { p_idempotency_key: KEY, p_month: "2026-10" });
  const denied = await callTool("reset_forecast", { idempotency_key: KEY, month: "2026-10" }, ["read"], rpc);
  assertEquals(denied.isError, true);
});

Deno.test("get_forecast has no cash net or big number for a month other than the newest cash month", async () => {
  const { rpc } = rpcOf(reads);
  const result = await callTool("get_forecast", { month: "2026-09" }, ["read"], rpc);
  const data = (result.structuredContent.ok ? result.structuredContent.data : null) as { cash_net_minor: number | null; big_number_minor: number | null } | null;
  assertEquals([data?.cash_net_minor, data?.big_number_minor], [null, null]);
});
