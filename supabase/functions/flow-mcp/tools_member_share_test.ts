// FLOW-1117: get_member_report, get_member_share and set_member_report. Fixtures: tools_test_support.ts.
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

Deno.test("get_member_share before any setting gives the company's figures with no members", async () => {
  const { rpc } = rpcOf(() => ({ status: 200, json: { ...REPORT, config: null } }));
  const read = await callTool("get_member_share", {}, ["read"], rpc);
  if (!read.structuredContent.ok) throw new Error("refused");
  const share = read.structuredContent.data as Share & { ownershipSet: boolean };
  assertEquals(share.ownershipSet, false);
  assertEquals(share.totals.saleNetMinor, 12_260_000);
});

Deno.test("set_member_report sends the parts as a patch, undo takes member_report", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "member_report" } } }));
  const set = await callTool("set_member_report", {
    idempotency_key: "mr-1",
    members: [{ name: "Member A", ownership_bp: 10000 }],
    quote_date: null,
  }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_set_member_report",
    body: { p_idempotency_key: "mr-1", p_patch: { members: [{ name: "Member A", ownership_bp: 10000 }], quote_date: null } },
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
    { idempotency_key: "k", quotes: [{ id: "q", lender: "Example", rate_ppm: 60_000, quoted_on: "2026-11-03" }] },
    { idempotency_key: "k", colour: "violet" },
  ]) {
    const result = await callTool("set_member_report", input, ["write"], rpc);
    assertEquals(result.isError, true);
  }
  assertEquals(calls.length, before);
});
