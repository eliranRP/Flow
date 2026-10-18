// Flow MCP tools tests: get_loans_paid (FLOW-142), what each loan paid since it started or in a year.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { LOAN, rpcOf } from "./tools_test_support.ts";

const BRIDGE = "dddddddd-dddd-4000-8000-0000000000d2";
const ENDED = "dddddddd-dddd-4000-8000-0000000000d3";

function loanRow(id: string, extra: Record<string, unknown>) {
  return {
    id,
    name: "Example Lending",
    currency: "USD",
    principal_minor: 10_000_000,
    annual_rate_ppm: 60_000,
    term_months: 360,
    start_date: "2025-03-01",
    payment_minor: 100_000,
    escrow_minor: 10_000,
    balance_minor: 9_000_000,
    status: "open",
    closed_on: null,
    kind: "amortizing",
    ...extra,
  };
}

function payment(id: string, docDate: string, principal: number, interest: number, escrow = 0, fees = 0) {
  return { transaction_id: id, doc_date: docDate, line_status: "posted", needs_review: false, principal_minor: principal, interest_minor: interest, escrow_minor: escrow, fees_minor: fees };
}

const PAYMENTS: Record<string, unknown[]> = {
  [LOAN]: [
    payment("t1", "2025-12-01", 50_000, 41_000, 10_000),
    payment("t2", "2026-01-01", 50_000, 40_000, 10_000),
    payment("t3", "2026-02-01", 50_000, 40_000, 10_000),
  ],
  [BRIDGE]: [payment("t4", "2026-05-01", 0, 30_000)],
  [ENDED]: [payment("t5", "2026-08-01", 999_900, 100)],
};

function fixture() {
  return rpcOf((name, body) => {
    if (name === "mcp_list_loans") {
      return { status: 200, json: [
        loanRow(LOAN, {}),
        loanRow(BRIDGE, { name: "Example Bridge", principal_minor: 5_000_000, balance_minor: 5_000_000, kind: "interest_only", interest_only_months: 12, start_date: "2026-04-01" }),
        loanRow(ENDED, { name: "Example Note", principal_minor: 1_000_000, balance_minor: 0, status: "paid_off", closed_on: "2026-08-31" }),
      ] };
    }
    if (name === "mcp_loan_payments") return { status: 200, json: PAYMENTS[String(body.p_loan_id)] ?? [] };
    return { status: 500, json: null };
  });
}

type PaidData = {
  period: string;
  year: number | null;
  loans: Array<{ loan_id: string; status: string; payments: number; splits_saved: boolean; paid: Record<string, number> }>;
  totals: Array<{ currency: string; open_loans: number; start_debt_minor: number; balance_minor: number; paid: Record<string, number> }>;
};

function dataOf(result: Awaited<ReturnType<typeof callTool>>): PaidData {
  if (!result.structuredContent.ok) throw new Error(JSON.stringify(result.structuredContent));
  return result.structuredContent.data as PaidData;
}

Deno.test("get_loans_paid: since the start, principal is the original less the balance and the rest is the saved splits", async () => {
  const { rpc } = fixture();
  const data = dataOf(await callTool("get_loans_paid", {}, ["read"], rpc));
  assertEquals(data.period, "all");
  assertEquals(data.year, null);
  assertEquals(data.loans[0]?.paid, { principal_minor: 1_000_000, interest_minor: 121_000, escrow_minor: 30_000, fees_minor: 0, total_minor: 1_151_000 });
  assertEquals(data.loans[0]?.payments, 3);
  // The loan that ended is listed but left out of the totals.
  assertEquals(data.loans[2]?.status, "paid_off");
  assertEquals(data.totals, [{
    currency: "USD",
    open_loans: 2,
    start_debt_minor: 15_000_000,
    balance_minor: 14_000_000,
    paid: { principal_minor: 1_000_000, interest_minor: 151_000, escrow_minor: 30_000, fees_minor: 0, total_minor: 1_181_000 },
  }]);
});

Deno.test("get_loans_paid: a year counts that year's payments and opens on today's balance plus the year's principal", async () => {
  const { rpc } = fixture();
  const data = dataOf(await callTool("get_loans_paid", { period: "year", year: 2026 }, ["read"], rpc));
  assertEquals(data.year, 2026);
  assertEquals(data.loans[0]?.paid, { principal_minor: 100_000, interest_minor: 80_000, escrow_minor: 20_000, fees_minor: 0, total_minor: 200_000 });
  assertEquals(data.totals[0]?.start_debt_minor, 14_100_000);
  assertEquals(data.totals[0]?.paid.total_minor, 230_000);
});

Deno.test("get_loans_paid: a loan with no payment attached shows its principal alone and says the splits are missing", async () => {
  const { rpc } = rpcOf((name) => {
    if (name === "mcp_list_loans") return { status: 200, json: [loanRow(LOAN, {})] };
    if (name === "mcp_loan_payments") return { status: 200, json: [] };
    return { status: 500, json: null };
  });
  const data = dataOf(await callTool("get_loans_paid", {}, ["read"], rpc));
  assertEquals(data.loans[0]?.splits_saved, false);
  assertEquals(data.loans[0]?.paid.total_minor, 1_000_000);
});

Deno.test("get_loans_paid: refuses a bad period or year, and a year without period year", async () => {
  const { rpc } = fixture();
  assertEquals((await callTool("get_loans_paid", { period: "month" }, ["read"], rpc)).isError, true);
  assertEquals((await callTool("get_loans_paid", { period: "year", year: "2026" }, ["read"], rpc)).isError, true);
  assertEquals((await callTool("get_loans_paid", { year: 2026 }, ["read"], rpc)).isError, true);
});
