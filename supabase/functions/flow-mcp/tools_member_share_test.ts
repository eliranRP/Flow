// FLOW-1117: get_member_report, get_member_share and set_member_report (FLOW-1124: all-in and members' loans). Fixtures: tools_test_support.ts.
// Invented names and figures only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { PROJECT, rpcOf } from "./tools_test_support.ts";

const QUOTE_ID = "00000000-0000-4000-8000-000000000001";

const REPORT = {
  config: {
    members: [{ name: "Member A", ownership_bp: 5000 }, { name: "Member B", ownership_bp: 5000 }],
    rate_rule: { tenor_years: 10, spread_bp: 150 },
    quotes: [{ id: QUOTE_ID, lender: "Example Lending", rate_ppm: 58_000, quoted_on: "2026-11-03" }],
    yields: [{ on_date: "2026-11-03", y5_ppm: 41_200, y10_ppm: 43_800 }],
  },
  properties: [{
    project_id: PROJECT, name: "Example Birch", currency: "USD", value_minor: 42_000_000, value_date: "2026-11-01",
    selling_cost_bp: 700, loan_balance_minor: 26_800_000, loans_other_currency: false,
  }],
  can_edit: true,
};

// FLOW-1124: the same report with an all-in and a member's own loan.
const NOTE_ID = "00000000-0000-4000-8000-000000000002";
const WITH_LOANS = {
  ...REPORT,
  config: { ...REPORT.config, members: [{ name: "Member A", ownership_bp: 5000, loan_ids: [NOTE_ID] }, { name: "Member B", ownership_bp: 5000 }] },
  properties: [{ ...REPORT.properties[0], all_in_minor: 30_000_000, purchase_minor: 30_000_000, rehab_minor: 0, holding_minor: 0 }],
  loans: [{ loan_id: NOTE_ID, name: "Member A note", kind: "demand", project_id: null, currency: "USD", balance_minor: 1_000_000 }],
};

type Share = {
  totals: { saleNetMinor: number; cashOutMinor: number };
  rate: { expectedPpm: number };
  quotes: { verdict: string }[];
  members: { name: string; saleMinor: number; refinanceMinor: number }[];
};

Deno.test("get_member_report passes the setting through", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: REPORT }));
  const read = await callTool("get_member_report", {}, ["read"], rpc);
  assertEquals(read.isError, false);
  assertEquals(calls.at(-1), { name: "get_member_report", body: {} });
  if (read.structuredContent.ok) assertEquals((read.structuredContent.data as typeof REPORT).can_edit, true);
});

Deno.test("get_member_share computes the app's figures, and one member by name", async () => {
  const { rpc } = rpcOf(() => ({ status: 200, json: REPORT }));
  const read = await callTool("get_member_share", {}, ["read"], rpc);
  assertEquals(read.isError, false);
  if (!read.structuredContent.ok) throw new Error("refused");
  const share = read.structuredContent.data as Share;
  assertEquals(share.totals.saleNetMinor, 12_260_000);
  assertEquals(share.totals.cashOutMinor, 4_070_000);
  assertEquals(share.rate.expectedPpm, 58_800);
  assertEquals(share.quotes[0]?.verdict, "good");
  assertEquals(share.members.map((m) => m.saleMinor), [6_130_000, 6_130_000]);

  const one = await callTool("get_member_share", { member: "member b" }, ["read"], rpc);
  if (!one.structuredContent.ok) throw new Error("refused");
  assertEquals((one.structuredContent.data as Share).members.map((m) => m.name), ["Member B"]);

  const nobody = await callTool("get_member_share", { member: "Member Z" }, ["read"], rpc);
  assertEquals(nobody.isError, true);
  if (!nobody.structuredContent.ok) assertEquals(nobody.structuredContent.error.code, "not_found");
});

Deno.test("get_member_share uses the Treasury's fetched yields where none was typed", async () => {
  const fetched = { ...REPORT, config: { ...REPORT.config, yields: [] }, treasury_yields: [{ on_date: "2026-10-30", y5_ppm: 40_900, y10_ppm: 43_500 }] };
  const { rpc } = rpcOf(() => ({ status: 200, json: fetched }));
  const read = await callTool("get_member_share", {}, ["read"], rpc);
  if (!read.structuredContent.ok) throw new Error("refused");
  const rate = (read.structuredContent.data as { rate: { yieldDate: string; yieldSource: string; expectedPpm: number } }).rate;
  assertEquals([rate.yieldDate, rate.yieldSource, rate.expectedPpm], ["2026-10-30", "treasury", 58_500]);
});

Deno.test("get_member_share before any setting gives the company's figures with no members", async () => {
  const { rpc } = rpcOf(() => ({ status: 200, json: { ...REPORT, config: null } }));
  const read = await callTool("get_member_share", {}, ["read"], rpc);
  if (!read.structuredContent.ok) throw new Error("refused");
  const share = read.structuredContent.data as Share & { ownershipSet: boolean };
  assertEquals(share.ownershipSet, false);
  assertEquals(share.totals.saleNetMinor, 12_260_000);
});

Deno.test("get_member_share counts the all-in and repays a member's own loan to them", async () => {
  const { rpc } = rpcOf(() => ({ status: 200, json: WITH_LOANS }));
  const read = await callTool("get_member_share", { member: "Member A" }, ["read"], rpc);
  if (!read.structuredContent.ok) throw new Error("refused");
  const share = read.structuredContent.data as {
    totals: { equityMinor: number; profitMinor: number };
    members: { saleMinor: number; loansMinor: number; saleTotalMinor: number; profitMinor: number }[];
  };
  assertEquals([share.totals.equityMinor, share.totals.profitMinor], [11_260_000, 9_060_000]);
  assertEquals(share.members.map((m) => [m.saleMinor, m.loansMinor, m.saleTotalMinor, m.profitMinor]), [[5_630_000, 1_000_000, 6_630_000, 4_530_000]]);
});

// FLOW-1126: the forecast's inputs for Birch: $3,100 rent, $290 tax a month, its mortgage.
const INPUTS = {
  as_of: "2026-10-31",
  properties: [{
    project_id: PROJECT, rent_minor: 310_000, rented_months: 12, units: 1,
    costs: [{ category_id: null, name: "Property tax", amount_minor: 348_000 }],
    loans: [{
      loan_id: "00000000-0000-4000-8000-000000000009", kind: "amortizing", currency: "USD", principal_minor: 26_800_000,
      annual_rate_ppm: 65_000, term_months: 360, start_date: "2026-11-01", payment_minor: 169_394,
      interest_only_months: null, amortization_months: null, balance_minor: 26_800_000, rates: [],
    }],
  }],
};

Deno.test("get_member_projection reads the report and the inputs, and answers the forecast for a year and a member", async () => {
  const { calls, rpc } = rpcOf((name) => ({ status: 200, json: name === "get_member_projection_inputs" ? INPUTS : WITH_LOANS }));
  const read = await callTool("get_member_projection", { years: 5, member: "member b" }, ["read"], rpc);
  if (!read.structuredContent.ok) throw new Error("refused");
  assertEquals(calls.map((c) => c.name), ["get_member_report", "get_member_projection_inputs"]);
  const projection = read.structuredContent.data as {
    years: number; totals: { rentMinor: number }[]; refi: { rateIsToday: boolean; ratePpm: number }; members: { name: string }[];
  };
  assertEquals(projection.years, 5);
  assertEquals(projection.totals.map((t) => t.rentMinor)[0], 3_720_000);
  assertEquals([projection.refi.rateIsToday, projection.refi.ratePpm], [true, 58_800]);
  assertEquals(projection.members.map((m) => m.name), ["Member B"]);
  for (const bad of [{ years: 0 }, { years: 11 }, { years: 2.5 }, { member: "" }]) {
    assertEquals((await callTool("get_member_projection", bad, ["read"], rpc)).isError, true);
  }
  const nobody = await callTool("get_member_projection", { member: "Member Z" }, ["read"], rpc);
  if (!nobody.structuredContent.ok) assertEquals(nobody.structuredContent.error.code, "not_found");
});

Deno.test("set_member_report takes the projection part within its bounds", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "member_report" } } }));
  const set = await callTool("set_member_report", { idempotency_key: "mp-1", projection: { rent_growth_bp: 400, by_year: { rent: { "2": 500 } } } }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1)?.body, { p_idempotency_key: "mp-1", p_patch: { projection: { rent_growth_bp: 400, by_year: { rent: { "2": 500 } } } } });
  const before = calls.length;
  for (const projection of [{ rent_growth_bp: 4000 }, { by_year: { rent: { "11": 1 } } }, { colour: 1 }, { category_types: { x: "tax" } }]) {
    assertEquals((await callTool("set_member_report", { idempotency_key: "k", projection }, ["write"], rpc)).isError, true);
  }
  assertEquals(calls.length, before);
});

Deno.test("set_member_report sends the parts as a patch, undo takes member_report", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "member_report" } } }));
  const set = await callTool("set_member_report", {
    idempotency_key: "mr-1",
    members: [{ name: "Member A", ownership_bp: 10000, loan_ids: [QUOTE_ID] }],
    quote_date: null,
  }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_set_member_report",
    body: { p_idempotency_key: "mr-1", p_patch: { members: [{ name: "Member A", ownership_bp: 10000, loan_ids: [QUOTE_ID] }], quote_date: null } },
  });
  await callTool("undo", { idempotency_key: "u-mr", kind: "member_report", id: PROJECT }, ["write"], rpc);
  assertEquals(calls.at(-1)?.name, "mcp_undo");

  const denied = await callTool("set_member_report", { idempotency_key: "k", quote_date: null }, ["read"], rpc);
  assertEquals(denied.isError, true);
  const before = calls.length;
  for (const input of [
    { idempotency_key: "k" },
    { idempotency_key: "k", rate_rule: { tenor_years: 7 } },
    { idempotency_key: "k", members: [{ name: "", ownership_bp: 10000 }] },
    { idempotency_key: "k", members: [{ name: "Member A", ownership_bp: 10000, loan_ids: ["not-a-uuid"] }] },
    { idempotency_key: "k", quotes: [{ id: "q", lender: "Example", rate_ppm: 60_000, quoted_on: "2026-11-03" }] },
    { idempotency_key: "k", colour: "violet" },
  ]) {
    const result = await callTool("set_member_report", input, ["write"], rpc);
    assertEquals(result.isError, true);
  }
  assertEquals(calls.length, before);
});

Deno.test("refresh_treasury_yields asks for the yields with its key only", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { requested: true } } }));
  const done = await callTool("refresh_treasury_yields", { idempotency_key: "ty-1" }, ["write"], rpc);
  assertEquals(done.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_refresh_treasury_yields", body: { p_idempotency_key: "ty-1" } });
  const denied = await callTool("refresh_treasury_yields", { idempotency_key: "ty-2" }, ["read"], rpc);
  assertEquals(denied.isError, true);
  const before = calls.length;
  for (const input of [{}, { idempotency_key: "" }, { idempotency_key: "ty-3", force: true }]) {
    assertEquals((await callTool("refresh_treasury_yields", input, ["write"], rpc)).isError, true);
  }
  assertEquals(calls.length, before);
});
