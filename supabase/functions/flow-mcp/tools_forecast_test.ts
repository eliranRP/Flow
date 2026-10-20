// Flow MCP tools tests: the month-end forecast (FLOW-141). get_forecast builds the items and the
// totals from its reads (the company currency among them); set_forecast_item and reset_forecast forward to their RPCs.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";
import { israelMonthKey } from "./tools_reports.ts";

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

function reads(name: string) {
  if (name === "expected_months") return { status: 200, json: expected };
  if (name === "list_unpaid") return { status: 200, json: unpaid };
  if (name === "cash_months") {
    return { status: 200, json: { basis: "cash", base_currency: "ILS", months: [{ month: "2026-10-01", by_currency: [{ currency: "ILS", net_minor: 120000 }] }] } };
  }
  if (name === "forecast_overrides_for") {
    return { status: 200, json: [{ item_key: "party:expense:p-rent:ILS", amount_minor: 480000, due_on: null, moved_out: false }] };
  }
  if (name === "mcp_company_loan_currency") return { status: 200, json: "ILS" };
  return { status: 500, json: null };
}

Deno.test("get_forecast reads its RPCs and builds the items, totals and changed count", async () => {
  const { calls, rpc } = rpcOf(reads);
  const result = await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc);
  assertEquals(result.isError, false);
  const data = (result.structuredContent.ok ? result.structuredContent.data : null) as {
    month: string;
    income_total_minor: number;
    expense_total_minor: number;
    changed: number;
    cash_net_minor: number | null;
    big_number_minor: number | null;
    expense: { minor: number; usual_minor: number; category_id: string | null }[];
  } | null;
  assertEquals(data?.month, "2026-10");
  assertEquals(data?.income_total_minor, 250000);
  assertEquals(data?.expense_total_minor, 480000);
  assertEquals(data?.changed, 1);
  assertEquals(data?.expense[0]?.minor, 480000);
  assertEquals(data?.expense[0]?.usual_minor, 500000);
  // לפי קטגוריה groups the items by their category.
  assertEquals(data?.expense[0]?.category_id, "c-rent");
  assertEquals(calls.map((call) => call.name).sort(), ["cash_months", "expected_months", "forecast_overrides_for", "list_unpaid", "mcp_company_loan_currency"]);
  // Home's number: the cash net + the income still to come - the charges still to go (small ones included).
  assertEquals(data?.cash_net_minor, 120000);
  assertEquals(data?.big_number_minor, 120000 + 250000 - 480000);
  assertEquals(calls.find((call) => call.name === "forecast_overrides_for")?.body, { p_month: "2026-10" });
});

Deno.test("get_forecast counts a dollar company's items and cash in dollars", async () => {
  const usd = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll('"ILS"', '"USD"').replaceAll(":ILS", ":USD"));
  const { rpc } = rpcOf((name) => name === "mcp_company_loan_currency" ? { status: 200, json: "USD" } : { ...reads(name), json: usd(reads(name).json) });
  const result = await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc);
  const data = (result.structuredContent.ok ? result.structuredContent.data : null) as {
    base_currency: string;
    income_total_minor: number;
    expense_total_minor: number;
    cash_net_minor: number | null;
  } | null;
  assertEquals(data?.base_currency, "USD");
  assertEquals(data?.income_total_minor, 250000);
  assertEquals(data?.expense_total_minor, 480000);
  assertEquals(data?.cash_net_minor, 120000);
});

Deno.test("get_forecast lists a yearly charge only in its due month (decision 0199)", async () => {
  const yearly = (due: string) => ({ direction: "expense", party_id: "p-plan", name: "Plan Co", currency: "ILS", typical_amount_minor: -44000, typical_day: 12, months_seen: 2, seen_this_month: false, pace: "year", next_due_month: due });
  const read = async (due: string) => {
    const { rpc } = rpcOf((name) => name === "expected_months" ? { status: 200, json: { ...expected, recurring: [...expected.recurring, yearly(due)] } } : reads(name));
    const result = await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc);
    return (result.structuredContent.ok ? result.structuredContent.data : null) as { expense_total_minor: number; small: { count: number } } | null;
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
  assertEquals(calls.find((call) => call.name === "forecast_overrides_for")?.body, { p_month: israelMonthKey() });
});

Deno.test("get_forecast refuses when a read fails", async () => {
  const { rpc } = rpcOf((name) => name === "list_unpaid" ? { status: 500, json: null } : reads(name));
  const result = await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc);
  assertEquals(result.isError, true);
});

Deno.test("get_forecast refuses when the company currency cannot be read, never counting in shekels", async () => {
  const { rpc } = rpcOf((name) => name === "mcp_company_loan_currency" ? { status: 500, json: null } : reads(name));
  assertEquals((await callTool("get_forecast", { month: "2026-10" }, ["read"], rpc)).isError, true);
  const odd = rpcOf((name) => name === "mcp_company_loan_currency" ? { status: 200, json: "dollars" } : reads(name));
  assertEquals((await callTool("get_forecast", { month: "2026-10" }, ["read"], odd.rpc)).isError, true);
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
