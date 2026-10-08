import { assertEquals } from "jsr:@std/assert@1";
import {
  allocateLoanSplit,
  scheduleRowForDate,
} from "../../../packages/shared/src/loan-split.ts";
import {
  buildLoanSchedule,
  contractualPaymentMinor,
  regularPaymentMinor,
} from "../../../packages/shared/src/loan-schedule.ts";
import { callTool, toolsFor } from "./tools.ts";

const LOAN = "dddddddd-dddd-4000-8000-0000000000d1";
const LOAN_TXN = "eeeeeeee-eeee-4000-8000-0000000000e1";
const TXN = "22222222-2222-4000-8000-000000000020";
const PROJECT = "8c1a0b2e-1111-4000-8000-000000000001";
const CATEGORY = "c0ffee00-1111-4000-8000-0000000000a1";
const INCOME_CATEGORY = "d1ffee00-1111-4000-8000-0000000000b2";
const REVIEW = "11111111-1111-4000-8000-000000000010";
const INCOME_TXN = "33333333-3333-4000-8000-000000000030";
const PROJECT_B = "8c1a0b2e-1111-4000-8000-000000000002";

type Rpc = { name: string; body: Record<string, unknown> };

const NO_META = {
  method: null,
  card_last4: null,
  memo: null,
  account: null,
  counterparty: null,
  bank_description: null,
};

function rpcOf(handler: (name: string, body: Record<string, unknown>) => { status: number; json: unknown }) {
  const calls: Rpc[] = [];
  const rpc = (name: string, body: Record<string, unknown>) => {
    calls.push({ name, body });
    return Promise.resolve(handler(name, body));
  };
  return { calls, rpc };
}

Deno.test("search_expenses filed and all call search_transactions", async () => {
  const { calls, rpc } = rpcOf((name) => name === "get_line_meta"
    ? { status: 200, json: [] }
    : {
      status: 200,
      json: { total: 1, expenses: [{ id: "11111111-1111-4000-8000-000000000001" }] },
    });
  const filed = await callTool("search_expenses", { scope: "filed", query: "אלפא" }, ["read"], rpc);
  assertEquals(filed.isError, false);
  assertEquals(calls[0]?.name, "search_transactions");
  assertEquals(calls[0]?.body.p_scope, "filed");
  const all = await callTool("search_expenses", { scope: "all" }, ["read"], rpc);
  assertEquals(all.isError, false);
  assertEquals(calls[2]?.name, "search_transactions");
  assertEquals(calls[2]?.body.p_scope, "all");
});

Deno.test("search_expenses passes its filters to search_transactions (FLOW-323)", async () => {
  const line = "11111111-1111-4000-8000-000000000323";
  const project = "22222222-2222-4000-8000-000000000323";
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_line_meta") return { status: 200, json: [] };
    if (name === "list_review") {
      return { status: 200, json: [
        { id: "r1", transaction_id: line, description: "א", reason: "missing_project" },
        { id: "r2", transaction_id: "11111111-1111-4000-8000-000000000999", description: "ב" },
      ] };
    }
    return { status: 200, json: { total: 1, expenses: [{ id: line }] } };
  });
  const filed = await callTool("search_expenses", {
    scope: "filed", from: "2026-06-01", to: "2026-06-30", direction: "income", project_id: project.toUpperCase(), category_id: "none",
  }, ["read"], rpc);
  assertEquals(filed.isError, false);
  assertEquals(calls[0]?.body, {
    p_query: null, p_scope: "filed", p_limit: 50, p_offset: 0,
    p_from: "2026-06-01", p_to: "2026-06-30", p_project: project, p_category: "none", p_direction: "income",
  });

  // Pending with a filter: search_transactions picks the page, the rows are list_review's.
  const pending = await callTool("search_expenses", { scope: "pending", project_id: "none" }, ["read"], rpc);
  assertEquals(pending.isError, false);
  const search = calls.filter((call) => call.name === "search_transactions").at(-1);
  assertEquals(search?.body.p_scope, "pending");
  assertEquals(search?.body.p_project, "none");
  if (pending.structuredContent.ok) {
    const data = pending.structuredContent.data as { total: number; expenses: Array<Record<string, unknown>> };
    assertEquals(data.total, 1);
    assertEquals(data.expenses.map((row) => [row.id, row.reason]), [[line, "missing_project"]]);
  }

  // A query alone also goes to search_transactions, which matches the supplier and the customer
  // in any case, not only the description.
  const queried = await callTool("search_expenses", { scope: "pending", query: "Example Tenant" }, ["read"], rpc);
  assertEquals(queried.isError, false);
  const byQuery = calls.filter((call) => call.name === "search_transactions").at(-1);
  assertEquals([byQuery?.body.p_scope, byQuery?.body.p_query], ["pending", "Example Tenant"]);

  // Without a filter, pending still filters list_review and filed sends no filter arguments.
  const before = calls.length;
  await callTool("search_expenses", { scope: "pending" }, ["read"], rpc);
  assertEquals(calls.slice(before).some((call) => call.name === "search_transactions"), false);
  await callTool("search_expenses", { scope: "all" }, ["read"], rpc);
  assertEquals(Object.keys(calls.filter((call) => call.name === "search_transactions").at(-1)?.body ?? {}).sort(),
    ["p_limit", "p_offset", "p_query", "p_scope"]);

  for (const bad of [
    { from: "2026-07-01", to: "2026-06-01" },
    { direction: "transfer" },
    { project_id: "alpha" },
    { category_id: "12" },
    { from: "06-01" },
  ]) {
    const result = await callTool("search_expenses", { scope: "all", ...bad }, ["read"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
});

Deno.test("the eight read tools call their own functions", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_dashboard") {
      return {
        status: 200,
        json: {
          company_id: "company-a",
          name: "א",
          projects: [],
          basis: "cash",
          income_agorot: 1,
          direct_agorot: 0,
          shared_agorot: 0,
          overhead_agorot: 0,
          expense_agorot: 0,
          net_profit_agorot: 1,
          active_projects: 0,
          review_count: 0,
          by_currency: [{ currency: "USD", income_minor: 100, direct_minor: 0, shared_minor: 0, overhead_minor: 0, expense_minor: 0, net_profit_minor: 100, count: 1 }],
        },
      };
    }
    if (name === "list_categories") return { status: 200, json: [{ id: "c1" }] };
    if (name === "list_review") return { status: 200, json: [{ id: "r1", transaction_id: "11111111-1111-4000-8000-000000000001", description: "אלפא" }] };
    if (name === "get_transaction") return { status: 200, json: { id: "11111111-1111-4000-8000-000000000001", description: "אלפא" } };
    if (name === "get_line_split") return { status: 200, json: null };
    if (name === "get_loan_split") return { status: 200, json: null };
    if (name === "get_line_meta") return { status: 200, json: [] };
    if (name === "mcp_list_loans") {
      return { status: 200, json: [{
        id: LOAN,
        name: "Example Bank",
        currency: "USD",
        principal_minor: 12000000,
        annual_rate_ppm: 68750,
        term_months: 360,
        start_date: "2026-01-01",
        payment_minor: 100000,
        escrow_minor: 10000,
        balance_minor: 12000000,
        flagged_parts: 3,
        flagged_transaction_ids: ["11111111-1111-4000-8000-000000000001"],
      }] };
    }
    return { status: 500, json: null };
  });
  const projects = await callTool("list_projects", {}, ["read"], rpc);
  const categories = await callTool("list_categories", {}, ["read"], rpc);
  const review = await callTool("list_review", {}, ["read"], rpc);
  const expense = await callTool("get_expense", { transaction_id: "11111111-1111-4000-8000-000000000001" }, ["read"], rpc);
  const pending = await callTool("search_expenses", { scope: "pending" }, ["read"], rpc);
  const totals = await callTool("get_totals", {}, ["read"], rpc);
  const loans = await callTool("list_loans", {}, ["read"], rpc);
  const schedule = await callTool("get_loan_schedule", { loan_id: LOAN }, ["read"], rpc);
  assertEquals(projects.isError, false);
  assertEquals(categories.isError, false);
  assertEquals(review.isError, false);
  assertEquals(expense.isError, false);
  assertEquals(pending.isError, false);
  assertEquals(totals.isError, false);
  if (totals.structuredContent.ok) {
    const data = totals.structuredContent.data as { by_currency: { currency: string }[] };
    assertEquals(data.by_currency[0]?.currency, "USD");
  }
  assertEquals(loans.isError, false);
  if (loans.structuredContent.ok) {
    const data = loans.structuredContent.data as { loans: { flagged_parts: number; flagged_transaction_ids: string[] }[] };
    assertEquals(data.loans[0]?.flagged_parts, 3);
    assertEquals(data.loans[0]?.flagged_transaction_ids, ["11111111-1111-4000-8000-000000000001"]);
  }
  assertEquals(schedule.isError, false);
  assertEquals(calls.map((call) => call.name), [
    "get_dashboard",
    "list_categories",
    "list_review",
    "get_line_meta",
    "get_transaction",
    "get_line_meta",
    "get_line_split",
    "get_loan_split",
    "list_review",
    "get_line_meta",
    "get_dashboard",
    "mcp_list_loans",
    "mcp_list_loans",
  ]);
});

Deno.test("a read failure does not say the write was refused", async () => {
  const { rpc } = rpcOf(() => ({ status: 500, json: null }));
  const result = await callTool("list_categories", {}, ["read"], rpc);
  assertEquals(result.isError, true);
  if (!result.structuredContent.ok) {
    assertEquals(result.structuredContent.error.message.includes("write was refused"), false);
    assertEquals(result.structuredContent.error.message, "The read was refused.");
  }
});

Deno.test("each tool accepts its arguments and rejects a bad one", async () => {
  const review = {
    id: "rev-1",
    transaction_id: "11111111-1111-4000-8000-000000000001",
    description: "אלפא",
    direction: "expense",
    reason: "missing_category",
    supplier_name: "גמא",
    doc_date: "2026-09-15",
  };
  const dashboard = {
    company_id: "company-a",
    name: "א",
    basis: "invoiced",
    projects: [{
      id: "p1",
      name: "הרצל",
      status: "active",
      income_agorot: 1,
      direct_agorot: 0,
      shared_agorot: 0,
      profit_agorot: 1,
      by_currency: [{ currency: "USD", income_minor: 50, direct_minor: 0, shared_minor: 0, profit_minor: 50 }],
    }],
    income_agorot: 1,
    direct_agorot: 0,
    shared_agorot: 0,
    overhead_agorot: 0,
    expense_agorot: 0,
    net_profit_agorot: 1,
    active_projects: 1,
    review_count: 0,
  };
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_dashboard") return { status: 200, json: dashboard };
    if (name === "list_categories") return { status: 200, json: [{ id: "c1" }] };
    if (name === "list_review") return { status: 200, json: [review] };
    if (name === "get_transaction") return { status: 200, json: { id: review.transaction_id, description: "אלפא" } };
    if (name === "get_line_split") return { status: 200, json: null };
    if (name === "get_loan_split") return { status: 200, json: null };
    // A pending query goes through search_transactions, which picks the line; the row is list_review's.
    if (name === "search_transactions") return { status: 200, json: { total: 1, expenses: [{ id: review.transaction_id }] } };
    if (name === "get_line_meta") return { status: 200, json: [] };
    return { status: 500, json: null };
  });
  const dates = { from: "2026-09-01", to: "2026-09-30", basis: "invoiced" };
  const projects = await callTool("list_projects", dates, ["read"], rpc);
  const totals = await callTool("get_totals", dates, ["read"], rpc);
  const reviewPage = await callTool("list_review", {
    direction: "expense",
    reason: "missing_category",
    supplier: "גמא",
    query: "אלפא",
    from: "2026-09-01",
    to: "2026-09-30",
    limit: 10,
    offset: 0,
  }, ["read"], rpc);
  const pending = await callTool("search_expenses", { scope: "pending", query: "אלפא", limit: 10, offset: 0 }, ["read"], rpc);
  const expense = await callTool("get_expense", { transaction_id: review.transaction_id }, ["read"], rpc);
  assertEquals(projects.isError, false);
  assertEquals(totals.isError, false);
  assertEquals(reviewPage.isError, false);
  assertEquals(pending.isError, false);
  assertEquals(expense.isError, false);
  if (projects.structuredContent.ok && "projects" in (projects.structuredContent.data as Record<string, unknown>)) {
    const rows = (projects.structuredContent.data as { projects: { name: string; by_currency: { currency: string }[] }[] }).projects;
    assertEquals(rows[0]?.name, "הרצל");
    assertEquals(rows[0]?.by_currency[0]?.currency, "USD");
  }
  if (totals.structuredContent.ok) {
    assertEquals((totals.structuredContent.data as { basis: string }).basis, "invoiced");
  }
  assertEquals(projects.structuredContent.ok, true);
  if (projects.structuredContent.ok) {
    assertEquals((projects.structuredContent.data as { basis: string }).basis, "invoiced");
  }
  const cashProjects = await callTool("list_projects", {}, ["read"], rpc);
  assertEquals(cashProjects.structuredContent.ok, true);
  if (cashProjects.structuredContent.ok) {
    assertEquals((cashProjects.structuredContent.data as { basis: string }).basis, "cash");
  }
  if (pending.structuredContent.ok) {
    const found = pending.structuredContent.data as { expenses: { id: string }[] };
    assertEquals(found.expenses[0]?.id, review.transaction_id);
  }
  assertEquals(calls.some((call) => call.name === "get_dashboard" && call.body.p_basis === "invoiced"), true);

  const badBasis = await callTool("list_projects", { basis: "accrual" }, ["read"], rpc);
  const badDate = await callTool("get_totals", { from: "09-01" }, ["read"], rpc);
  const forged = await callTool("list_projects", { company_id: "other" }, ["read"], rpc);
  const extra = await callTool("list_categories", { scope: "all" }, ["read"], rpc);
  const badDirection = await callTool("list_review", { direction: "transfer" }, ["read"], rpc);
  const badScope = await callTool("search_expenses", { scope: "secret" }, ["read"], rpc);
  const badId = await callTool("get_expense", { transaction_id: "not-a-uuid" }, ["read"], rpc);
  const badLimit = await callTool("search_expenses", { limit: 101 }, ["read"], rpc);
  const badOffset = await callTool("list_review", { offset: -1 }, ["read"], rpc);
  const unknown = await callTool("drop_ledger", {}, ["read"], rpc);
  for (const result of [badBasis, badDate, forged, extra, badDirection, badScope, badId, badLimit, badOffset, unknown]) {
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
});

Deno.test("get_expense reports not found, and a read error stays a read error", async () => {
  const missing = await callTool("get_expense", { transaction_id: "11111111-1111-4000-8000-000000000001" }, ["read"], () => Promise.resolve({ status: 200, json: null }));
  assertEquals(missing.isError, true);
  if (!missing.structuredContent.ok) assertEquals(missing.structuredContent.error.code, "not_found");
  const refused = await callTool("search_expenses", { scope: "filed" }, ["read"], () => Promise.resolve({ status: 500, json: null }));
  assertEquals(refused.isError, true);
  if (!refused.structuredContent.ok) assertEquals(refused.structuredContent.error.message, "The read was refused.");
});

Deno.test("get_expense returns the loan split parts, and skips the read for income", async () => {
  const id = "11111111-1111-4000-8000-000000000001";
  const split = {
    loan_id: "22222222-2222-4000-8000-000000000002",
    loan_name: "Example Bank",
    needs_review: false,
    by_parts: true,
    parts: [
      { part: "interest", amount_minor: 70000, in_pnl: true },
      { part: "escrow", amount_minor: 20000, in_pnl: true },
      { part: "principal", amount_minor: 10000, in_pnl: false },
    ],
  };
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_transaction") return { status: 200, json: { id, direction: "expense", amount_net: -100000 } };
    if (name === "get_loan_split") return { status: 200, json: split };
    if (name === "get_line_split") return { status: 200, json: null };
    if (name === "get_line_meta") return { status: 200, json: [] };
    return { status: 500, json: null };
  });
  const expense = await callTool("get_expense", { transaction_id: id }, ["read"], rpc);
  assertEquals(expense.isError, false);
  if (expense.structuredContent.ok) {
    const data = expense.structuredContent.data as { id: string; loan_split: typeof split };
    assertEquals(data.id, id);
    assertEquals(data.loan_split, split);
    const sum = data.loan_split.parts.reduce((total, part) => total + part.amount_minor, 0);
    assertEquals(sum, 100000);
  }
  assertEquals(calls.find((call) => call.name === "get_loan_split")?.body, { p_transaction_id: id });

  const plain = await callTool("get_expense", { transaction_id: id }, ["read"], rpcOf((name) => (
    name === "get_transaction"
      ? { status: 200, json: { id, direction: "expense" } }
      : name === "get_line_meta" ? { status: 200, json: [] } : { status: 200, json: null }
  )).rpc);
  if (plain.structuredContent.ok) assertEquals((plain.structuredContent.data as { loan_split: unknown }).loan_split, null);

  const income = rpcOf((name) => (
    name === "get_transaction"
      ? { status: 200, json: { id, direction: "income" } }
      : name === "get_line_split" ? { status: 200, json: null }
      : name === "get_line_meta" ? { status: 200, json: [] } : { status: 500, json: null }
  ));
  const incomeRow = await callTool("get_expense", { transaction_id: id }, ["read"], income.rpc);
  assertEquals(incomeRow.isError, false);
  assertEquals(income.calls.map((call) => call.name), ["get_transaction", "get_line_meta", "get_line_split"]);

  const failed = await callTool("get_expense", { transaction_id: id }, ["read"], rpcOf((name) => (
    name === "get_transaction"
      ? { status: 200, json: { id, direction: "expense" } }
      : name === "get_line_split" ? { status: 200, json: null } : { status: 500, json: null }
  )).rpc);
  assertEquals(failed.isError, true);
  if (!failed.structuredContent.ok) assertEquals(failed.structuredContent.error.message, "The read was refused.");
});

Deno.test("a token without read scope is forbidden", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: [] }));
  const result = await callTool("list_categories", {}, ["write"], rpc);
  assertEquals(result.isError, true);
  if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "forbidden");
  assertEquals(calls.length, 0);
});

Deno.test("write tools are listed only for a write scope", () => {
  assertEquals(toolsFor(["read"]).map((tool) => tool.name).includes("assign_expense"), false);
  assertEquals(toolsFor(["write"]).map((tool) => tool.name), [
    "assign_expense",
    "assign_expense_split",
    "assign_expenses",
    "set_expense_category",
    "create_project",
    "create_category",
    "create_projects",
    "create_categories",
    "sync_bank",
    "hide_category",
    "set_category_pnl",
    "set_overhead_project",
    "rename_company",
    "add_loan",
    "update_loan",
    "attach_loan_payment",
    "set_loan_rate",
    "split_line",
    "set_line_pnl",
    "set_lines_pnl",
    "set_invoice_paid",
    "detach_loan_payment",
    "delete_loan",
    "reorder_loans",
    "set_project_investment",
    "set_category_rehab",
    "delete_category",
    "move_category_lines",
    "set_company_currency",
    "rename_category",
    "set_category_group",
    "set_jev_mode",
    "undo_jev_prefill",
    "undo",
    "undo_batch",
    "get_sync_status",
  ]);
  for (const tool of toolsFor(["write"])) {
    const expected = tool.name === "get_sync_status"
      ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
      : { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
    assertEquals(tool.annotations, expected);
  }
  assertEquals(toolsFor(["read", "write"]).map((tool) => tool.name), [
    "list_projects",
    "get_project",
    "get_project_categories",
    "list_categories",
    "list_review",
    "get_expense",
    "search_expenses",
    "get_totals",
    "list_loans",
    "get_loan_schedule",
    "get_sync_status",
    "get_breakdown",
    "get_jev_status",
    "get_jev_accuracy",
    "get_profit_months",
    "get_anomalies",
    "get_jev_suggestions",
    "get_missing_bills",
    "get_expected_months",
    "list_unpaid",
    "assign_expense",
    "assign_expense_split",
    "assign_expenses",
    "set_expense_category",
    "create_project",
    "create_category",
    "create_projects",
    "create_categories",
    "sync_bank",
    "hide_category",
    "set_category_pnl",
    "set_overhead_project",
    "rename_company",
    "add_loan",
    "update_loan",
    "attach_loan_payment",
    "set_loan_rate",
    "split_line",
    "set_line_pnl",
    "set_lines_pnl",
    "set_invoice_paid",
    "detach_loan_payment",
    "delete_loan",
    "reorder_loans",
    "set_project_investment",
    "set_category_rehab",
    "delete_category",
    "move_category_lines",
    "set_company_currency",
    "rename_category",
    "set_category_group",
    "set_jev_mode",
    "undo_jev_prefill",
    "undo",
    "undo_batch",
  ]);
  assertEquals(toolsFor([]), []);
});

Deno.test("assign_expense_split forwards shares and optional category", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { undo_kind: "reassign", id: REVIEW, closed_review: false } },
  }));
  const split = await callTool("assign_expense_split", {
    idempotency_key: "split-1",
    transaction_id: TXN,
    category_id: CATEGORY,
    shares: [
      { project_id: PROJECT, share: 50 },
      { project_id: PROJECT_B, share: 50 },
    ],
  }, ["write"], rpc);
  assertEquals(split.isError, false);
  assertEquals(calls[0], {
    name: "mcp_assign_expense_split",
    body: {
      p_idempotency_key: "split-1",
      p_transaction_id: TXN,
      p_category_id: CATEGORY,
      p_shares: [
        { project_id: PROJECT, share: 50 },
        { project_id: PROJECT_B, share: 50 },
      ],
    },
  });
  const replay = await callTool("assign_expense_split", {
    idempotency_key: "split-2",
    transaction_id: TXN,
    shares: [
      { project_id: PROJECT, share: 60 },
      { project_id: PROJECT_B, share: 40 },
    ],
  }, ["write"], rpc);
  assertEquals(replay.isError, false);
  assertEquals(calls[1]?.body.p_category_id, undefined);
});

Deno.test("split_line forwards parts in order with null projects", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { transaction_id: TXN, parts: [], undo_kind: "line_split", id: TXN } },
  }));
  const split = await callTool("split_line", {
    idempotency_key: "line-1",
    transaction_id: TXN,
    parts: [
      { category_id: CATEGORY, project_id: PROJECT, amount_minor: 25000 },
      { category_id: CATEGORY, project_id: PROJECT_B, amount_minor: 292000 },
      { category_id: INCOME_CATEGORY, amount_minor: 1 },
    ],
  }, ["write"], rpc);
  assertEquals(split.isError, false);
  assertEquals(calls[0], {
    name: "mcp_split_line",
    body: {
      p_idempotency_key: "line-1",
      p_transaction_id: TXN,
      p_parts: [
        { category_id: CATEGORY, project_id: PROJECT, amount_minor: 25000 },
        { category_id: CATEGORY, project_id: PROJECT_B, amount_minor: 292000 },
        { category_id: INCOME_CATEGORY, project_id: null, amount_minor: 1 },
      ],
    },
  });
  const cleared = await callTool("split_line", { idempotency_key: "line-2", transaction_id: TXN, parts: [] }, ["write"], rpc);
  assertEquals(cleared.isError, false);
  assertEquals(calls[1]?.body.p_parts, []);
  const undo = await callTool("undo", { idempotency_key: "u-1", kind: "line_split", id: TXN }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls[2], { name: "mcp_undo", body: { p_idempotency_key: "u-1", p_kind: "line_split", p_id: TXN } });
});

Deno.test("set_line_pnl and set_lines_pnl forward in_pnl, null included", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { transaction_id: TXN, in_pnl: false, undo_kind: "line_pnl", id: TXN } },
  }));
  const out = await callTool("set_line_pnl", { idempotency_key: "p-1", transaction_id: TXN, in_pnl: false }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(calls[0], {
    name: "mcp_set_line_pnl",
    body: { p_idempotency_key: "p-1", p_transaction_id: TXN, p_in_pnl: false },
  });
  const cleared = await callTool("set_line_pnl", { idempotency_key: "p-2", transaction_id: TXN, in_pnl: null }, ["write"], rpc);
  assertEquals(cleared.isError, false);
  assertEquals(calls[1]?.body.p_in_pnl, null);
  const batch = await callTool("set_lines_pnl", {
    idempotency_key: "b-1",
    items: [{ transaction_id: TXN, in_pnl: true }, { transaction_id: PROJECT, in_pnl: null }],
  }, ["write"], rpc);
  assertEquals(batch.isError, false);
  assertEquals(calls[2], {
    name: "mcp_set_lines_pnl",
    body: { p_idempotency_key: "b-1", p_items: [{ transaction_id: TXN, in_pnl: true }, { transaction_id: PROJECT, in_pnl: null }] },
  });
  const undo = await callTool("undo", { idempotency_key: "u-1", kind: "line_pnl", id: TXN }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls[3], { name: "mcp_undo", body: { p_idempotency_key: "u-1", p_kind: "line_pnl", p_id: TXN } });
});

Deno.test("set_line_pnl and set_lines_pnl validate input and refuse read tokens", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const denied = await callTool("set_line_pnl", { idempotency_key: "k", transaction_id: TXN, in_pnl: false }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const badOne: unknown[] = [
    { idempotency_key: "k", transaction_id: TXN },
    { idempotency_key: "k", transaction_id: TXN, in_pnl: "no" },
    { idempotency_key: "k", transaction_id: "not-a-uuid", in_pnl: false },
    { idempotency_key: "", transaction_id: TXN, in_pnl: false },
    { idempotency_key: "k", transaction_id: TXN, in_pnl: false, company_id: TXN },
  ];
  for (const input of badOne) {
    const result = await callTool("set_line_pnl", input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  const badMany: unknown[] = [
    { idempotency_key: "k", items: [] },
    { idempotency_key: "k", items: [{ transaction_id: TXN, in_pnl: false }, { transaction_id: TXN, in_pnl: true }] },
    { idempotency_key: "k", items: [{ transaction_id: TXN }] },
    { idempotency_key: "k", items: [{ transaction_id: TXN, in_pnl: false, project_id: PROJECT }] },
    { idempotency_key: "k".repeat(125), items: [{ transaction_id: TXN, in_pnl: false }] },
    { idempotency_key: "k", items: Array.from({ length: 201 }, () => ({ transaction_id: TXN, in_pnl: false })) },
  ];
  for (const input of badMany) {
    const result = await callTool("set_lines_pnl", input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
});

Deno.test("split_line forwards percent and rest parts", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { transaction_id: TXN, parts: [], undo_kind: "line_split", id: TXN } },
  }));
  const split = await callTool("split_line", {
    idempotency_key: "line-pct",
    transaction_id: TXN,
    parts: [
      { category_id: CATEGORY, project_id: PROJECT, percent: 33.3333 },
      { category_id: CATEGORY, project_id: PROJECT_B, amount_minor: 500 },
      { rest: true },
    ],
  }, ["write"], rpc);
  assertEquals(split.isError, false);
  assertEquals(calls[0]?.body.p_parts, [
    { category_id: CATEGORY, project_id: PROJECT, percent: 33.3333 },
    { category_id: CATEGORY, project_id: PROJECT_B, amount_minor: 500 },
    { project_id: null, rest: true },
  ]);
  const bad: unknown[] = [
    [{ category_id: CATEGORY, percent: 0 }, { rest: true }],
    [{ category_id: CATEGORY, percent: 100.5 }, { rest: true }],
    [{ category_id: CATEGORY, percent: 1.00001 }, { rest: true }],
    [{ category_id: CATEGORY, percent: 10, amount_minor: 5 }, { rest: true }],
    [{ category_id: CATEGORY }, { rest: true }],
    [{ percent: 10 }, { rest: true }],
    [{ category_id: CATEGORY, percent: 10 }, { rest: false }],
    [{ category_id: CATEGORY, percent: 10 }, { rest: true }, { category_id: INCOME_CATEGORY, rest: true }],
  ];
  for (const parts of bad) {
    const result = await callTool("split_line", { idempotency_key: "k", transaction_id: TXN, parts }, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 1);
});

Deno.test("split_line validates parts and refuses read tokens", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const two = [
    { category_id: CATEGORY, amount_minor: 100 },
    { category_id: INCOME_CATEGORY, amount_minor: 200 },
  ];
  const denied = await callTool("split_line", { idempotency_key: "k", transaction_id: TXN, parts: two }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const bad: unknown[] = [
    { idempotency_key: "k", transaction_id: TXN, parts: [two[0]] },
    { idempotency_key: "k", transaction_id: TXN, parts: [two[0], { ...two[0], amount_minor: 5 }] },
    { idempotency_key: "k", transaction_id: TXN, parts: [two[0], { ...two[1], amount_minor: 0 }] },
    { idempotency_key: "k", transaction_id: TXN, parts: [two[0], { ...two[1], amount_minor: 1.5 }] },
    { idempotency_key: "k", transaction_id: TXN, parts: [two[0], { ...two[1], amount_minor: "200" }] },
    { idempotency_key: "k", transaction_id: TXN, parts: [two[0], { ...two[1], share: 50 }] },
    { idempotency_key: "k", transaction_id: TXN, parts: [two[0], { ...two[1], project_id: "nope" }] },
    { idempotency_key: "k", transaction_id: TXN, parts: Array.from({ length: 51 }, (_, i) => ({ category_id: CATEGORY, amount_minor: i + 1 })) },
    { idempotency_key: "k", transaction_id: TXN, parts: Array.from({ length: 51 }, (_, i) => ({ category_id: CATEGORY, project_id: `8c1a0b2e-1111-4000-8000-${String(i).padStart(12, "0")}`, amount_minor: i + 1 })) },
    { idempotency_key: "k", transaction_id: "not-a-uuid", parts: two },
    { idempotency_key: "", transaction_id: TXN, parts: two },
    { idempotency_key: "k", transaction_id: TXN, parts: two, company_id: TXN },
  ];
  for (const input of bad) {
    const result = await callTool("split_line", input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
});

Deno.test("get_expense adds line_split parts only when the line is split", async () => {
  const parts = [{ category_id: CATEGORY, project_id: null, amount_minor: 100 }];
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_transaction") return { status: 200, json: { id: TXN, amount_net: -300 } };
    if (name === "get_line_split") {
      return { status: 200, json: { transaction_id: TXN, currency: "USD", line_minor: 300, parts, parts_match: false } };
    }
    if (name === "get_loan_split") return { status: 200, json: null };
    if (name === "get_line_meta") return { status: 200, json: [] };
    return { status: 500, json: null };
  });
  const split = await callTool("get_expense", { transaction_id: TXN }, ["read"], rpc);
  assertEquals(split.isError, false);
  if (split.structuredContent.ok) {
    assertEquals(split.structuredContent.data, {
      id: TXN,
      amount_net: -300,
      meta: NO_META,
      line_split: { currency: "USD", line_minor: 300, parts, parts_match: false },
      loan_split: null,
    });
  }
  assertEquals(calls[2], { name: "get_line_split", body: { p_transaction_id: TXN } });
  const whole = await callTool("get_expense", { transaction_id: TXN }, ["read"], (name) =>
    Promise.resolve(name === "get_transaction"
      ? { status: 200, json: { id: TXN } }
      : name === "get_loan_split" ? { status: 200, json: null }
      : name === "get_line_meta" ? { status: 200, json: [] } : { status: 200, json: { transaction_id: TXN, parts: [] } }));
  assertEquals(whole.isError, false);
  if (whole.structuredContent.ok) assertEquals(whole.structuredContent.data, { id: TXN, meta: NO_META, loan_split: null });
  const failed = await callTool("get_expense", { transaction_id: TXN }, ["read"], (name) =>
    Promise.resolve(name === "get_transaction" ? { status: 200, json: { id: TXN } } : { status: 500, json: null }));
  assertEquals(failed.isError, true);
  if (!failed.structuredContent.ok) assertEquals(failed.structuredContent.error.code, "refused");
});

Deno.test("assign_expense_split validates shares and refuses read tokens", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const denied = await callTool("assign_expense_split", {
    idempotency_key: "split-1",
    transaction_id: TXN,
    shares: [{ project_id: PROJECT, share: 50 }, { project_id: PROJECT_B, share: 50 }],
  }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const cases = [
    callTool("assign_expense_split", { idempotency_key: "k", transaction_id: TXN, shares: [] }, ["write"], rpc),
    callTool("assign_expense_split", {
      idempotency_key: "k",
      transaction_id: TXN,
      shares: [{ project_id: PROJECT, share: 100 }],
    }, ["write"], rpc),
    callTool("assign_expense_split", {
      idempotency_key: "k",
      transaction_id: TXN,
      shares: [
        { project_id: PROJECT, share: 50 },
        { project_id: PROJECT, share: 50 },
      ],
    }, ["write"], rpc),
    callTool("assign_expense_split", {
      idempotency_key: "k",
      transaction_id: TXN,
      shares: [
        { project_id: PROJECT, share: 40 },
        { project_id: PROJECT_B, share: 40 },
      ],
    }, ["write"], rpc),
    callTool("assign_expense_split", {
      idempotency_key: "k",
      transaction_id: TXN,
      shares: [
        { project_id: PROJECT, share: 50 },
        { project_id: PROJECT_B, share: 50 },
      ],
      mcp_tid: TXN,
    }, ["write"], rpc),
    // A share is a whole percent from 1 to 100, a share row takes no other key, and 50 rows is the cap.
    ...[
      [{ project_id: PROJECT, share: 50.5 }, { project_id: PROJECT_B, share: 49.5 }],
      [{ project_id: PROJECT, share: 0 }, { project_id: PROJECT_B, share: 100 }],
      [{ project_id: PROJECT, share: 101 }, { project_id: PROJECT_B, share: -1 }],
      [{ project_id: PROJECT, share: 50, note: "x" }, { project_id: PROJECT_B, share: 50 }],
      Array.from({ length: 51 }, (_, i) => ({
        project_id: `8c1a0b2e-1111-4000-8000-${String(i).padStart(12, "0")}`,
        share: i === 0 ? 50 : 1,
      })),
    ].map((shares) =>
      callTool("assign_expense_split", { idempotency_key: "k", transaction_id: TXN, shares }, ["write"], rpc)
    ),
  ];
  for (const pending of cases) {
    const result = await pending;
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  const refused = await callTool("assign_expense_split", {
    idempotency_key: "split-foreign",
    transaction_id: TXN,
    shares: [{ project_id: PROJECT, share: 50 }, { project_id: PROJECT_B, share: 50 }],
  }, ["write"], () => Promise.resolve({
    status: 200,
    json: { ok: false, error: { code: "refused", message: "transaction not found" } },
  }));
  assertEquals(refused.isError, true);
  if (!refused.structuredContent.ok) {
    assertEquals(refused.structuredContent.error.code, "refused");
    assertEquals(refused.structuredContent.error.message, "transaction not found");
  }
  assertEquals(calls.length, 0);
});

Deno.test("assign_expense forwards project and category for an income review line", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { undo_kind: "review", id: REVIEW, closed_review: true } },
  }));
  const assigned = await callTool("assign_expense", {
    idempotency_key: "assign-income",
    transaction_id: INCOME_TXN,
    project_id: PROJECT,
    category_id: INCOME_CATEGORY,
  }, ["write"], rpc);
  assertEquals(assigned.isError, false);
  assertEquals(calls[0], {
    name: "mcp_assign_expense",
    body: {
      p_idempotency_key: "assign-income",
      p_transaction_id: INCOME_TXN,
      p_project_id: PROJECT,
      p_category_id: INCOME_CATEGORY,
      p_remember: false,
    },
  });
  if (assigned.structuredContent.ok) {
    const data = assigned.structuredContent.data as { closed_review: boolean; undo_kind: string };
    assertEquals(data.closed_review, true);
    assertEquals(data.undo_kind, "review");
  }
});

Deno.test("assign_expense without a project forwards null for a kept-out category", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { undo_kind: "review", id: REVIEW, closed_review: true } },
  }));
  for (const project_id of [undefined, null]) {
    const assigned = await callTool("assign_expense", {
      idempotency_key: "assign-kept-out",
      transaction_id: INCOME_TXN,
      ...(project_id === undefined ? {} : { project_id }),
      category_id: INCOME_CATEGORY,
    }, ["write"], rpc);
    assertEquals(assigned.isError, false);
  }
  assertEquals(calls.length, 2);
  for (const call of calls) {
    assertEquals(call.name, "mcp_assign_expense");
    assertEquals(call.body.p_project_id, null);
  }
  const bad = await callTool("assign_expense", {
    idempotency_key: "assign-bad",
    transaction_id: INCOME_TXN,
    project_id: "not-a-uuid",
    category_id: INCOME_CATEGORY,
  }, ["write"], rpc);
  assertEquals(bad.isError, true);
  assertEquals(calls.length, 2);
});

Deno.test("names with control or invisible characters are refused before the RPC", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  for (
    const name of [
      "Site\u200bBeta", "Site\u0007Beta", "\u202eSite Beta", "Site\ufeffBeta", "Site\u00adBeta",
      "Site\u200fBeta", "Site\u061cBeta", "Site\u2028Beta", "Site\u{e0041}Beta", "Site\u3164Beta",
    ]
  ) {
    const project = await callTool("create_project", { idempotency_key: "k", name }, ["write"], rpc);
    assertEquals(project.isError, true, JSON.stringify(name));
    const category = await callTool("create_category", { idempotency_key: "k", name, kind: "expense" }, ["write"], rpc);
    assertEquals(category.isError, true, JSON.stringify(name));
    const batch = await callTool("create_projects", { idempotency_key: "k", items: [{ name }] }, ["write"], rpc);
    assertEquals(batch.isError, true, JSON.stringify(name));
    const loan = await callTool("update_loan", { idempotency_key: "k", loan_id: PROJECT, name }, ["write"], rpc);
    assertEquals(loan.isError, true, JSON.stringify(name));
    const categories = await callTool("create_categories", { idempotency_key: "k", items: [{ name, kind: "expense" }] }, ["write"], rpc);
    assertEquals(categories.isError, true, JSON.stringify(name));
    const added = await callTool("add_loan", {
      idempotency_key: "k", name, principal: "1000", annual_rate_percent: 5, term_months: 12, start_date: "2026-01-01",
    }, ["write"], rpc);
    assertEquals(added.isError, true, JSON.stringify(name));
  }
  assertEquals(calls.length, 0);
  // Hebrew and an emoji joined with ZWJ are fine.
  const ok = await callTool("create_project", { idempotency_key: "k", name: "פרויקט 👨‍👩‍👧" }, ["write"], rpc);
  assertEquals(ok.isError, false);
  const marked = await callTool("create_project", { idempotency_key: "k2", name: "שָׁלוֹם ❤️ 🇮🇱" }, ["write"], rpc);
  assertEquals(marked.isError, false);
  assertEquals(calls.length, 2);
});

Deno.test("a refused name says why, rename_company takes the same rule, and wide spaces become plain (FLOW-205)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const messageOf = (result: { structuredContent: unknown }) =>
    (result.structuredContent as { error?: { message?: string } }).error?.message;
  const project = await callTool("create_project", { idempotency_key: "k", name: "Site\u200fBeta" }, ["write"], rpc);
  assertEquals(messageOf(project), "name has an invisible or control character");
  const batch = await callTool("create_categories", { idempotency_key: "k", items: [{ name: "Cat\u200bOne", kind: "expense" }] }, ["write"], rpc);
  assertEquals(messageOf(batch), "name has an invisible or control character");
  const company = await callTool("rename_company", { idempotency_key: "k", name: "Example\u200fCo" }, ["write"], rpc);
  assertEquals(messageOf(company), "name has an invisible or control character");
  const short = await callTool("create_project", { idempotency_key: "k", name: "A" }, ["write"], rpc);
  assertEquals(messageOf(short), "validation");
  assertEquals(calls.length, 0);
  await callTool("create_project", { idempotency_key: "k3", name: "Site\u00a0Beta\u2009Two" }, ["write"], rpc);
  await callTool("rename_company", { idempotency_key: "k4", name: "Example\u202fCo" }, ["write"], rpc);
  assertEquals(calls.map((call) => call.body.p_name), ["Site Beta Two", "Example Co"]);
});

Deno.test("assign_expense and set_expense_category describe reversals", () => {
  const byName = new Map(toolsFor(["write"]).map((tool) => [tool.name, tool.description]));
  for (const name of ["assign_expense", "set_expense_category"]) {
    const text = byName.get(name) ?? "";
    assertEquals(text.includes("reversal"), true, `${name} names reversals`);
    assertEquals(text.includes("negative income"), true, `${name} says an outflow can be negative income`);
    assertEquals(text.includes("negative expense"), true, `${name} says an inflow can be negative expense`);
  }
  assertEquals((byName.get("assign_expense") ?? "").includes("project_id can be left out"), true);
});

Deno.test("a reversal is forwarded as given: an expense line under an income category and the reverse", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { undo_kind: "reassign", id: REVIEW, closed_review: false } },
  }));
  const outflow = await callTool("assign_expense", {
    idempotency_key: "rev-1",
    transaction_id: TXN,
    project_id: PROJECT,
    category_id: INCOME_CATEGORY,
  }, ["write"], rpc);
  assertEquals(outflow.isError, false);
  assertEquals(calls[0]?.name, "mcp_assign_expense");
  assertEquals(calls[0]?.body.p_category_id, INCOME_CATEGORY);
  const inflow = await callTool("set_expense_category", {
    idempotency_key: "rev-2",
    transaction_id: INCOME_TXN,
    category_id: CATEGORY,
  }, ["write"], rpc);
  assertEquals(inflow.isError, false);
  assertEquals(calls[1]?.name, "mcp_set_expense_category");
  assertEquals(calls[1]?.body.p_category_id, CATEGORY);
});

Deno.test("income assign forwards the project, single and batch, and get_project passes income through", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_project") {
      return {
        status: 200,
        json: { id: PROJECT, income_agorot: 50000, by_currency: [{ currency: "ILS", income_minor: 50000 }] },
      };
    }
    if (name === "mcp_assign_expenses") {
      return {
        status: 200,
        json: { ok: true, data: { batch_key: BATCH_KEY, ok_count: 1, error_count: 0, results: [] } },
      };
    }
    return { status: 200, json: { ok: true, data: { undo_kind: "reassign", id: REVIEW, closed_review: false } } };
  });
  const single = await callTool("assign_expense", {
    idempotency_key: "assign-income-plain",
    transaction_id: INCOME_TXN,
    project_id: PROJECT,
    category_id: INCOME_CATEGORY,
  }, ["write"], rpc);
  assertEquals(single.isError, false);
  assertEquals(calls[0]?.body.p_project_id, PROJECT);
  const batch = await callTool("assign_expenses", {
    idempotency_key: "assign-income-batch",
    items: [{ transaction_id: INCOME_TXN, project_id: PROJECT, category_id: INCOME_CATEGORY }],
  }, ["write"], rpc);
  assertEquals(batch.isError, false);
  assertEquals(calls[1]?.body.p_items, [{ transaction_id: INCOME_TXN, project_id: PROJECT, category_id: INCOME_CATEGORY }]);
  const read = await callTool("get_project", { id: PROJECT }, ["read"], rpc);
  assertEquals(read.isError, false);
  if (read.structuredContent.ok) {
    assertEquals((read.structuredContent.data as { income_agorot: number }).income_agorot, 50000);
  }
});

Deno.test("assign, set category, and undo call their wrappers", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { undo_kind: "reassign", id: REVIEW, closed_review: false } },
  }));
  const assigned = await callTool("assign_expense", {
    idempotency_key: "assign-20",
    transaction_id: TXN,
    project_id: PROJECT,
    category_id: CATEGORY,
  }, ["write"], rpc);
  assertEquals(assigned.isError, false);
  assertEquals(calls[0], {
    name: "mcp_assign_expense",
    body: {
      p_idempotency_key: "assign-20",
      p_transaction_id: TXN,
      p_project_id: PROJECT,
      p_category_id: CATEGORY,
      p_remember: false,
    },
  });
  const remembered = await callTool("assign_expense", {
    idempotency_key: "assign-21",
    transaction_id: TXN,
    project_id: PROJECT,
    category_id: CATEGORY,
    remember: true,
  }, ["read", "write"], rpc);
  assertEquals(remembered.isError, false);
  assertEquals(calls[1]?.body.p_remember, true);
  const category = await callTool("set_expense_category", {
    idempotency_key: "cat-20",
    transaction_id: TXN,
    category_id: CATEGORY,
  }, ["write"], rpc);
  assertEquals(category.isError, false);
  assertEquals(calls[2]?.name, "mcp_set_expense_category");
  assertEquals(calls[2]?.body.p_category_id, CATEGORY);
  const undone = await callTool("undo", {
    idempotency_key: "undo-30",
    kind: "reassign",
    id: REVIEW,
  }, ["write"], rpc);
  assertEquals(undone.isError, false);
  if (undone.structuredContent.ok) {
    const data = undone.structuredContent.data as { undo_kind: string; closed_review: boolean };
    assertEquals(data.undo_kind, "reassign");
    assertEquals(data.closed_review, false);
  }
  assertEquals(calls[3], {
    name: "mcp_undo",
    body: { p_idempotency_key: "undo-30", p_kind: "reassign", p_id: REVIEW },
  });
});

Deno.test("a read token cannot write and a write argument is validated", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const denied = await callTool("assign_expense", {
    idempotency_key: "assign-20",
    transaction_id: TXN,
    project_id: PROJECT,
    category_id: CATEGORY,
  }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const cases = [
    callTool("assign_expense", { idempotency_key: "", transaction_id: TXN, project_id: PROJECT, category_id: CATEGORY }, ["write"], rpc),
    callTool("assign_expense", { idempotency_key: "k", transaction_id: "review", project_id: PROJECT, category_id: CATEGORY }, ["write"], rpc),
    callTool("assign_expense", { idempotency_key: "k".repeat(129), transaction_id: TXN, project_id: PROJECT, category_id: CATEGORY }, ["write"], rpc),
    callTool("assign_expense", { idempotency_key: "k", transaction_id: TXN, project_id: PROJECT, category_id: CATEGORY, remember: "yes" }, ["write"], rpc),
    callTool("assign_expense", { idempotency_key: "k", transaction_id: TXN, project_id: PROJECT, category_id: CATEGORY, mcp_tid: TXN }, ["write"], rpc),
    callTool("assign_expense", { idempotency_key: "k", transaction_id: TXN, project_id: PROJECT, category_id: CATEGORY, user_id: TXN }, ["write"], rpc),
    callTool("set_expense_category", { idempotency_key: "k", transaction_id: TXN }, ["write"], rpc),
    callTool("undo", { idempotency_key: "k", kind: "batch", id: REVIEW }, ["write"], rpc),
    callTool("undo", { idempotency_key: "k", kind: "review", id: "not-a-uuid" }, ["write"], rpc),
    callTool("assign_expense_split", { idempotency_key: "k" }, ["write"], rpc),
  ];
  for (const pending of cases) {
    const result = await pending;
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
});

Deno.test("a database refusal stays a tool error and an HTTP failure is generic", async () => {
  const refused = await callTool("assign_expense", {
    idempotency_key: "assign-20",
    transaction_id: TXN,
    project_id: PROJECT,
    category_id: CATEGORY,
  }, ["write"], () => Promise.resolve({
    status: 200,
    json: { ok: false, error: { code: "refused", message: "transaction not found" } },
  }));
  assertEquals(refused.isError, true);
  if (!refused.structuredContent.ok) {
    assertEquals(refused.structuredContent.error.code, "refused");
    assertEquals(refused.structuredContent.error.message, "transaction not found");
  }
  const reviewId = await callTool("set_expense_category", {
    idempotency_key: "cat-20",
    transaction_id: TXN,
    category_id: CATEGORY,
  }, ["write"], () => Promise.resolve({
    status: 200,
    json: {
      ok: false,
      error: { code: "validation", message: "id is not a transaction; list_review.id is the review id" },
    },
  }));
  assertEquals(reviewId.isError, true);
  if (!reviewId.structuredContent.ok) {
    assertEquals(reviewId.structuredContent.error.message, "id is not a transaction; list_review.id is the review id");
  }
  const conflict = await callTool("undo", {
    idempotency_key: "undo-30",
    kind: "review",
    id: REVIEW,
  }, ["write"], () => Promise.resolve({
    status: 200,
    json: { ok: false, error: { code: "conflict", message: "conflict" } },
  }));
  assertEquals(conflict.isError, true);
  if (!conflict.structuredContent.ok) assertEquals(conflict.structuredContent.error.code, "conflict");
  const retry = await callTool("assign_expense", {
    idempotency_key: "assign-22",
    transaction_id: TXN,
    project_id: PROJECT,
    category_id: CATEGORY,
  }, ["write"], () => Promise.resolve({
    status: 200,
    json: { ok: false, error: { code: "unavailable", message: "retry" } },
  }));
  assertEquals(retry.isError, true);
  if (!retry.structuredContent.ok) {
    assertEquals(retry.structuredContent.error.code, "unavailable");
    assertEquals(retry.structuredContent.error.message, "retry");
  }
  const http = await callTool("undo", {
    idempotency_key: "undo-31",
    kind: "review",
    id: REVIEW,
  }, ["write"], () => Promise.resolve({ status: 400, json: { message: "secret material" } }));
  assertEquals(http.isError, true);
  if (!http.structuredContent.ok) assertEquals(http.structuredContent.error.message, "The write was refused.");
});

const PROJECT_NEW = "aaaaaaaa-aaaa-4000-8000-0000000000a1";
const CATEGORY_NEW = "bbbbbbbb-bbbb-4000-8000-0000000000b1";

Deno.test("create_project and create_category send exact p_* bodies", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { id: PROJECT_NEW, undo_kind: "project" } },
  }));
  const project = await callTool("create_project", {
    idempotency_key: "proj-1",
    name: "Site Alpha",
    status: "finished",
  }, ["write"], rpc);
  assertEquals(project.isError, false);
  assertEquals(calls[0], {
    name: "mcp_create_project",
    body: { p_idempotency_key: "proj-1", p_name: "Site Alpha", p_status: "finished" },
  });
  const category = await callTool("create_category", {
    idempotency_key: "cat-new-1",
    name: "Tools",
    kind: "expense",
  }, ["write"], rpc);
  assertEquals(category.isError, false);
  assertEquals(calls[1], {
    name: "mcp_create_category",
    body: { p_idempotency_key: "cat-new-1", p_name: "Tools", p_kind: "expense" },
  });
});

Deno.test("create_projects and create_categories send one batch write each", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: {
      ok: true,
      data: {
        batch_key: "cccccccc-cccc-4000-8000-0000000000c1",
        ok_count: 1,
        error_count: 1,
        results: [
          { name: "Site Alpha", ok: true, id: PROJECT_NEW, undo_kind: "project" },
          { name: "Site Beta", ok: false, code: "refused", existing_id: PROJECT_NEW },
        ],
      },
    },
  }));
  const projects = await callTool("create_projects", {
    idempotency_key: "setup-p",
    items: [{ name: "  Site Alpha " }, { name: "Site Beta", status: "finished" }],
  }, ["write"], rpc);
  assertEquals(projects.isError, false);
  assertEquals(calls[0], {
    name: "mcp_create_projects",
    body: {
      p_idempotency_key: "setup-p",
      p_items: [{ name: "Site Alpha" }, { name: "Site Beta", status: "finished" }],
    },
  });
  if (projects.structuredContent.ok) {
    assertEquals((projects.structuredContent.data as { error_count: number }).error_count, 1);
  }
  const categories = await callTool("create_categories", {
    idempotency_key: "setup-c",
    items: [{ name: "Tools", kind: "expense" }, { name: "Tools", kind: "income" }],
  }, ["write"], rpc);
  assertEquals(categories.isError, false);
  assertEquals(calls[1], {
    name: "mcp_create_categories",
    body: {
      p_idempotency_key: "setup-c",
      p_items: [{ name: "Tools", kind: "expense" }, { name: "Tools", kind: "income" }],
    },
  });
});

Deno.test("setup batches refuse bad rows before any write", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const many = Array.from({ length: 101 }, (_, index) => ({ name: `Site ${index}` }));
  const cases = [
    callTool("create_projects", { idempotency_key: "k", items: [] }, ["write"], rpc),
    callTool("create_projects", { idempotency_key: "k", items: many }, ["write"], rpc),
    callTool("create_projects", { idempotency_key: "k", items: [{ name: "x" }] }, ["write"], rpc),
    callTool("create_projects", { idempotency_key: "k", items: [{ name: "Site A" }, { name: " Site A" }] }, ["write"], rpc),
    callTool("create_projects", { idempotency_key: "k", items: [{ name: "Site A", company_id: "forged" }] }, ["write"], rpc),
    callTool("create_projects", { idempotency_key: "k".repeat(125), items: [{ name: "Site A" }] }, ["write"], rpc),
    callTool("create_categories", { idempotency_key: "k", items: [{ name: "Tools" }] }, ["write"], rpc),
    callTool("create_categories", { idempotency_key: "k", items: [{ name: "Tools", kind: "asset" }] }, ["write"], rpc),
    callTool("create_categories", {
      idempotency_key: "k",
      items: [{ name: "Tools", kind: "expense" }, { name: "Tools ", kind: "expense" }],
    }, ["write"], rpc),
  ];
  for (const pending of cases) {
    const result = await pending;
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  const denied = await callTool("create_categories", {
    idempotency_key: "k",
    items: [{ name: "Tools", kind: "expense" }],
  }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  assertEquals(calls.length, 0);
});

Deno.test("cycle 4 write validation and read-token forbidden", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const cases = [
    callTool("create_project", { idempotency_key: "k", name: "x" }, ["write"], rpc),
    callTool("create_project", { idempotency_key: "k", name: "Good", status: "open" }, ["write"], rpc),
    callTool("create_project", { idempotency_key: "k", name: "Good", company_id: "forged" }, ["write"], rpc),
    callTool("create_category", { idempotency_key: "k", name: "x", kind: "expense" }, ["write"], rpc),
    callTool("create_category", { idempotency_key: "k", name: "Good", kind: "asset" }, ["write"], rpc),
    callTool("create_category", { idempotency_key: "k", name: "Good", kind: "expense", extra: true }, ["write"], rpc),
    callTool("sync_bank", { idempotency_key: "k", from: "2026-01-01" }, ["write"], rpc),
  ];
  for (const pending of cases) {
    const result = await pending;
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  const denied = await callTool("create_project", {
    idempotency_key: "k",
    name: "Site Beta",
  }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  assertEquals(calls.length, 0);
});

Deno.test("undo accepts project and category kinds", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { kind: "project", id: PROJECT_NEW } },
  }));
  const project = await callTool("undo", {
    idempotency_key: "undo-proj",
    kind: "project",
    id: PROJECT_NEW,
  }, ["write"], rpc);
  assertEquals(project.isError, false);
  assertEquals(calls[0]?.body.p_kind, "project");
  const category = await callTool("undo", {
    idempotency_key: "undo-cat",
    kind: "category",
    id: CATEGORY_NEW,
  }, ["write"], rpc);
  assertEquals(category.isError, false);
  assertEquals(calls[1]?.body.p_kind, "category");
});

const JOB = "abababab-abab-4000-8000-0000000000ab";

/** begin proceeds with JOB; finish and status are recorded; status echoes the last finish. */
function syncRpc() {
  const calls: Rpc[] = [];
  let finished: Record<string, unknown> | null = null;
  const rpc = (name: string, body: Record<string, unknown>) => {
    calls.push({ name, body });
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed", job_id: JOB } } });
    }
    if (name === "mcp_sync_bank_finish") {
      finished = body.p_response as Record<string, unknown>;
      return Promise.resolve({ status: 200, json: { ok: true, data: { job_id: JOB, state: "done" } } });
    }
    if (name === "mcp_sync_status") {
      const done = finished as { ok?: boolean; data?: Record<string, unknown>; error?: unknown } | null;
      const data = done == null
        ? { job_id: JOB, state: "running" }
        : done.ok === true
        ? { job_id: JOB, state: "done", ...done.data }
        : { job_id: JOB, state: "failed", error: done.error };
      return Promise.resolve({ status: 200, json: { ok: true, data } });
    }
    return Promise.resolve({ status: 500, json: null });
  };
  return { calls, rpc, finishedBody: () => calls.find((call) => call.name === "mcp_sync_bank_finish")?.body };
}

Deno.test("sync_bank returns the job at once and finishes it in the background", async () => {
  const { calls, rpc, finishedBody } = syncRpc();
  let release: (value: { status: number; json: unknown }) => void = () => {};
  const pull = new Promise<{ status: number; json: unknown }>((resolve) => {
    release = resolve;
  });
  const invokeCalls: { fn: string; body: Record<string, unknown> }[] = [];
  const invoke = (fn: string, body: Record<string, unknown>) => {
    invokeCalls.push({ fn, body });
    return pull;
  };
  const deferred: Promise<unknown>[] = [];
  const first = await callTool("sync_bank", { idempotency_key: "sync-1" }, ["write"], rpc, invoke, (work) => {
    deferred.push(work);
  });
  assertEquals(first.isError, false);
  assertEquals(first.structuredContent, { ok: true, data: { job_id: JOB, state: "running" } });
  assertEquals(invokeCalls, [{ fn: "mercury-sync", body: { force: true } }]);
  assertEquals(deferred.length, 1);
  assertEquals(finishedBody(), undefined, "nothing stored while the pull runs");

  const running = await callTool("get_sync_status", { job_id: JOB }, ["write"], rpc);
  assertEquals(running.structuredContent, { ok: true, data: { job_id: JOB, state: "running" } });

  release({ status: 200, json: { ok: true, lines: 2, inserted: 1, updated: 1, removed: 0, newest_date: "2026-09-15" } });
  await Promise.all(deferred);
  assertEquals(finishedBody(), {
    p_job_id: JOB,
    p_response: { ok: true, data: { added: 1, duplicates: 1, removed: 0, newest_date: "2026-09-15" } },
  });
  const done = await callTool("get_sync_status", { job_id: JOB }, ["read"], rpc);
  assertEquals(done.structuredContent, {
    ok: true,
    data: { job_id: JOB, state: "done", added: 1, duplicates: 1, removed: 0, newest_date: "2026-09-15" },
  });
  assertEquals(calls.filter((call) => call.name === "mcp_sync_status").map((call) => call.body), [
    { p_job_id: JOB },
    { p_job_id: JOB },
  ]);
});

Deno.test("sync_bank replay returns the same job without a second pull", async () => {
  let invoked = 0;
  const { calls, rpc } = rpcOf((name) => {
    if (name === "mcp_sync_bank_begin") return { status: 200, json: { ok: true, data: { state: "replay", job_id: JOB } } };
    if (name === "mcp_sync_status") return { status: 200, json: { ok: true, data: { job_id: JOB, state: "running" } } };
    return { status: 500, json: null };
  });
  const replay = await callTool("sync_bank", { idempotency_key: "sync-1" }, ["write"], rpc, () => {
    invoked += 1;
    return Promise.resolve({ status: 200, json: {} });
  }, () => {
    throw new Error("nothing to defer");
  });
  assertEquals(replay.structuredContent, { ok: true, data: { job_id: JOB, state: "running" } });
  assertEquals(invoked, 0);
  assertEquals(calls.map((call) => call.name), ["mcp_sync_bank_begin", "mcp_sync_status"]);

  const legacy = await callTool("sync_bank", { idempotency_key: "old" }, ["write"], () =>
    Promise.resolve({
      status: 200,
      json: { ok: true, data: { added: 1, duplicates: 0, removed: 0, newest_date: null } },
    }));
  assertEquals(legacy.structuredContent, { ok: true, data: { added: 1, duplicates: 0, removed: 0, newest_date: null } });
});

Deno.test("sync_bank begin errors are returned at once", async () => {
  const noConn = await callTool("sync_bank", { idempotency_key: "sync-2" }, ["write"], () =>
    Promise.resolve({
      status: 200,
      json: { ok: false, error: { code: "not_found", message: "bank is not connected" } },
    }));
  assertEquals(noConn.isError, true);
  if (!noConn.structuredContent.ok) {
    assertEquals(noConn.structuredContent.error.code, "not_found");
    assertEquals(noConn.structuredContent.error.message, "bank is not connected");
  }
  const odd = await callTool("sync_bank", { idempotency_key: "sync-2b" }, ["write"], () =>
    Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed" } } }));
  assertEquals(odd.isError, true, "proceed without a job id is refused");
  const empty = await callTool("sync_bank", { idempotency_key: "sync-2d" }, ["write"], () =>
    Promise.resolve({ status: 200, json: { ok: true, data: {} } }));
  assertEquals(empty.isError, true, "an unknown begin shape is refused");
  const down = await callTool("sync_bank", { idempotency_key: "sync-2c" }, ["write"], () =>
    Promise.resolve({ status: 503, json: null }));
  assertEquals(down.isError, true);
});

Deno.test("sync_bank records each pull failure on the job", async () => {
  const cases: { pull: { status: number; json: unknown } | Error | null; error: { code: string; message: string } }[] = [
    { pull: { status: 200, json: { ok: true, lines: 0, skipped: true } }, error: { code: "unavailable", message: "retry" } },
    { pull: { status: 429, json: { error: "rate_limited" } }, error: { code: "unavailable", message: "retry" } },
    { pull: { status: 500, json: { error: "Mercury is not connected" } }, error: { code: "not_found", message: "bank is not connected" } },
    {
      pull: { status: 500, json: { error: "auth" } },
      error: { code: "refused", message: "bank key was rejected; reconnect in Settings" },
    },
    { pull: { status: 401, json: null }, error: { code: "unavailable", message: "unavailable" } },
    { pull: { status: 500, json: { error: "sync_failed" } }, error: { code: "refused", message: "The bank sync failed." } },
    { pull: { status: 504, json: null }, error: { code: "refused", message: "The bank sync failed." } },
    // The finish step validates the shape: bad counts or dates are not stored as a result.
    {
      pull: { status: 200, json: { ok: true, inserted: "1", updated: 0, removed: 0, newest_date: null } },
      error: { code: "refused", message: "The bank sync failed." },
    },
    {
      pull: { status: 200, json: { ok: true, inserted: 1, updated: -1, removed: 0, newest_date: null } },
      error: { code: "refused", message: "The bank sync failed." },
    },
    {
      pull: { status: 200, json: { ok: true, inserted: 1.5, updated: 0, removed: 0, newest_date: null } },
      error: { code: "refused", message: "The bank sync failed." },
    },
    {
      pull: { status: 200, json: { ok: true, inserted: 1, updated: 0, removed: 0, newest_date: "15/09/2026" } },
      error: { code: "refused", message: "The bank sync failed." },
    },
    { pull: new Error("boom"), error: { code: "refused", message: "The bank sync failed." } },
    { pull: null, error: { code: "unavailable", message: "unavailable" } },
  ];
  for (const [index, item] of cases.entries()) {
    const { rpc, finishedBody } = syncRpc();
    const invoke = item.pull == null
      ? undefined
      : () => item.pull instanceof Error ? Promise.reject(item.pull) : Promise.resolve(item.pull as { status: number; json: unknown });
    // No defer: the pull runs before the call returns and the result is the job state.
    const result = await callTool("sync_bank", { idempotency_key: `sync-f${index}` }, ["write"], rpc, invoke);
    assertEquals(finishedBody(), { p_job_id: JOB, p_response: { ok: false, error: item.error } }, `case ${index}`);
    assertEquals(result.structuredContent, { ok: true, data: { job_id: JOB, state: "failed", error: item.error } }, `case ${index}`);
  }
});

Deno.test("sync_bank survives a finish call that throws", async () => {
  const deferred: Promise<unknown>[] = [];
  const result = await callTool("sync_bank", { idempotency_key: "sync-t" }, ["write"], (name) => {
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed", job_id: JOB } } });
    }
    return Promise.reject(new Error("network"));
  }, () => Promise.resolve({ status: 200, json: { ok: true, inserted: 0, updated: 0, removed: 0, newest_date: null } }), (work) => {
    deferred.push(work);
  });
  assertEquals(result.isError, false);
  await Promise.all(deferred);
});

Deno.test("get_sync_status checks the id and scope and passes errors through", async () => {
  const { calls, rpc } = rpcOf((_name, body) => {
    if (body.p_job_id === JOB) return { status: 200, json: { ok: false, error: { code: "not_found", message: "not found" } } };
    return { status: 500, json: null };
  });
  const bad = await callTool("get_sync_status", { job_id: "nope" }, ["read"], rpc);
  if (!bad.structuredContent.ok) assertEquals(bad.structuredContent.error.code, "validation");
  const extra = await callTool("get_sync_status", { job_id: JOB, company_id: "x" }, ["read"], rpc);
  assertEquals(extra.isError, true);
  const none = await callTool("get_sync_status", { job_id: JOB }, [], rpc);
  if (!none.structuredContent.ok) assertEquals(none.structuredContent.error.code, "forbidden");
  assertEquals(calls.length, 0);
  const missing = await callTool("get_sync_status", { job_id: JOB }, ["write"], rpc);
  if (!missing.structuredContent.ok) assertEquals(missing.structuredContent.error.code, "not_found");
  const refused = await callTool("get_sync_status", { job_id: JOB }, ["read"], () => Promise.resolve({ status: 500, json: null }));
  if (!refused.structuredContent.ok) assertEquals(refused.structuredContent.error.message, "The read was refused.");
});

Deno.test("add_loan sends exact p_* bodies and default payment matches the schedule", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "mcp_company_loan_currency") return { status: 200, json: "USD" };
    if (name === "mcp_add_loan") {
      return { status: 200, json: { ok: true, data: { id: LOAN, undo_kind: "loan" } } };
    }
    return { status: 500, json: null };
  });
  const principalMinor = 25000000n;
  const ratePpm = 68750;
  const escrowMinor = 10000n;
  const term = 360;
  const level = contractualPaymentMinor({ principalMinor, annualRatePpm: ratePpm, termMonths: term }) + escrowMinor;
  const result = await callTool("add_loan", {
    idempotency_key: "loan-add-1",
    name: "Example Bank",
    principal: "250000.00",
    annual_rate_percent: 6.875,
    term_months: term,
    start_date: "2026-01-01",
    escrow: "100.00",
  }, ["write"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls[1], {
    name: "mcp_add_loan",
    body: {
      p_idempotency_key: "loan-add-1",
      p_name: "Example Bank",
      p_principal_minor: Number(principalMinor),
      p_annual_rate_ppm: ratePpm,
      p_term_months: term,
      p_start_date: "2026-01-01",
      p_payment_minor: Number(level),
      p_escrow_minor: Number(escrowMinor),
      p_currency: "USD",
    },
  });
});

Deno.test("loan amount and rate conversion and validation", async () => {
  const { rpc } = rpcOf((name) => {
    if (name === "mcp_company_loan_currency") return { status: 200, json: "ILS" };
    if (name === "mcp_add_loan") return { status: 200, json: { ok: true, data: { id: LOAN, undo_kind: "loan" } } };
    if (name === "mcp_update_loan") return { status: 200, json: { ok: true, data: { id: LOAN, undo_kind: "loan_update" } } };
    return { status: 500, json: null };
  });
  const zeroRate = await callTool("add_loan", {
    idempotency_key: "loan-z",
    name: "Zero",
    principal: 1000,
    annual_rate_percent: 0,
    term_months: 12,
    start_date: "2026-01-01",
  }, ["write"], rpc);
  assertEquals(zeroRate.isError, false);
  const big = await callTool("add_loan", {
    idempotency_key: "loan-big",
    name: "Big",
    principal: "1000000.01",
    annual_rate_percent: "6.875",
    term_months: 12,
    start_date: "2026-01-01",
    currency: "USD",
  }, ["write"], rpc);
  assertEquals(big.isError, false);
  const badCases = [
    callTool("add_loan", { idempotency_key: "k", name: "X", principal: 1, annual_rate_percent: 1, term_months: 12, start_date: "2026-01-01", extra: true }, ["write"], rpc),
    callTool("add_loan", { idempotency_key: "k", name: "X", principal: 1, annual_rate_percent: 1, term_months: 12, start_date: "2026-01-01", company_id: LOAN }, ["write"], rpc),
    callTool("add_loan", { idempotency_key: "k", name: "X", principal: 1, annual_rate_percent: 1, term_months: 0, start_date: "2026-01-01" }, ["write"], rpc),
    callTool("add_loan", { idempotency_key: "k", name: "X", principal: 1, annual_rate_percent: 1, term_months: 601, start_date: "2026-01-01" }, ["write"], rpc),
    callTool("add_loan", { idempotency_key: "k", name: "X", principal: -1, annual_rate_percent: 1, term_months: 12, start_date: "2026-01-01" }, ["write"], rpc),
    callTool("add_loan", { idempotency_key: "k", name: "X", principal: 1, annual_rate_percent: 1, term_months: 12, start_date: "01-01-2026" }, ["write"], rpc),
    callTool("update_loan", { idempotency_key: "k", loan_id: LOAN, currency: "EUR" }, ["write"], rpc),
  ];
  for (const pending of badCases) {
    const out = await pending;
    assertEquals(out.isError, true);
    if (!out.structuredContent.ok) assertEquals(out.structuredContent.error.code, "validation");
  }
  const denied = await callTool("add_loan", {
    idempotency_key: "k",
    name: "X",
    principal: 1,
    annual_rate_percent: 1,
    term_months: 12,
    start_date: "2026-01-01",
  }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
});

Deno.test("attach_loan_payment matches writeSplit parts and schedule paging works", async () => {
  const loanRow = {
    id: LOAN,
    name: "Example Bank",
    currency: "USD",
    principal_minor: 12000000,
    annual_rate_ppm: 68750,
    term_months: 360,
    start_date: "2026-01-01",
    payment_minor: 100000,
    escrow_minor: 10000,
    balance_minor: 12000000,
  };
  const lineMinor = 100000n;
  const schedule = buildLoanSchedule({
    principalMinor: BigInt(loanRow.principal_minor),
    annualRatePpm: loanRow.annual_rate_ppm,
    termMonths: loanRow.term_months,
    startDate: loanRow.start_date,
    paymentMinor: BigInt(loanRow.payment_minor),
    escrowMinor: BigInt(loanRow.escrow_minor),
  });
  const row = scheduleRowForDate(schedule.rows, "2026-01-01");
  if (row == null) throw new Error("missing schedule row");
  const expected = allocateLoanSplit({
    lineMinor,
    interestMinor: row.interestMinor,
    escrowMinor: row.escrowMinor,
    principalMinor: row.principalMinor,
  });
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_transaction") {
      return { status: 200, json: { id: LOAN_TXN, doc_date: "2026-01-01", amount_original: Number(lineMinor), currency: "USD" } };
    }
    if (name === "mcp_list_loans") return { status: 200, json: [loanRow] };
    if (name === "get_loan_split") return { status: 200, json: null };
    if (name === "mcp_attach_loan_payment") {
      return { status: 200, json: { ok: true, data: { loan_id: LOAN, transaction_id: LOAN_TXN, undo_kind: "loan_split" } } };
    }
    return { status: 500, json: null };
  });
  const attached = await callTool("attach_loan_payment", {
    idempotency_key: "split-1",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
  }, ["write"], rpc);
  assertEquals(attached.isError, false);
  assertEquals(calls.find((call) => call.name === "mcp_attach_loan_payment")?.body.p_parts, expected.map((part) => ({
    part: part.part,
    amount_minor: Number(part.amountMinor),
    scheduled_minor: Number(part.scheduledMinor),
  })));
  const page = await callTool("get_loan_schedule", { loan_id: LOAN, from: 1, limit: 2 }, ["read"], rpc);
  assertEquals(page.isError, false);
  if (page.structuredContent.ok) {
    const data = page.structuredContent.data as { from: number; limit: number; total: number; rows: unknown[] };
    assertEquals(data.from, 1);
    assertEquals(data.limit, 2);
    assertEquals(data.rows.length, 2);
    assertEquals(data.total, schedule.rows.length);
  }
});

Deno.test("a stored loan whose payment is below the interest is refused, not thrown", async () => {
  const lowRow = {
    id: LOAN,
    name: "Example Bank",
    currency: "USD",
    principal_minor: 12000000,
    annual_rate_ppm: 60000,
    term_months: 360,
    start_date: "2026-01-01",
    payment_minor: 1000,
    escrow_minor: 0,
    balance_minor: 12000000,
  };
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_transaction") {
      return { status: 200, json: { id: LOAN_TXN, doc_date: "2026-01-01", amount_original: 1000, currency: "USD" } };
    }
    if (name === "mcp_list_loans") return { status: 200, json: [lowRow] };
    if (name === "get_loan_split") return { status: 200, json: null };
    return { status: 500, json: null };
  });
  const page = await callTool("get_loan_schedule", { loan_id: LOAN }, ["read"], rpc);
  assertEquals(page.structuredContent, { ok: false, error: { code: "refused", message: "payment below interest" } });
  const attached = await callTool("attach_loan_payment", {
    idempotency_key: "split-low",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
  }, ["write"], rpc);
  assertEquals(attached.structuredContent, { ok: false, error: { code: "refused", message: "payment below interest" } });
  assertEquals(calls.some((call) => call.name === "mcp_attach_loan_payment"), false);
});

Deno.test("update_loan trims the name and rejects explicit nulls before the database", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: LOAN, undo_kind: "loan_update" } } }));
  const trimmed = await callTool("update_loan", { idempotency_key: "up-trim", loan_id: LOAN, name: "  Example Bank  " }, ["write"], rpc);
  assertEquals(trimmed.isError, false);
  assertEquals(calls[0]?.body.p_patch, { name: "Example Bank" });
  for (const field of ["name", "principal", "annual_rate_percent", "term_months", "start_date", "payment", "escrow"]) {
    const result = await callTool("update_loan", { idempotency_key: `up-null-${field}`, loan_id: LOAN, [field]: null }, ["write"], rpc);
    assertEquals(result.structuredContent, { ok: false, error: { code: "validation", message: "validation" } });
  }
  const blank = await callTool("update_loan", { idempotency_key: "up-blank", loan_id: LOAN, name: "   " }, ["write"], rpc);
  assertEquals(blank.isError, true);
  assertEquals(calls.length, 1);
});

const BATCH_KEY = "33333333-3333-4000-8000-000000000003";

Deno.test("assign_expenses sends exact p_items and validates batch input", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: {
      ok: true,
      data: {
        batch_key: BATCH_KEY,
        ok_count: 1,
        error_count: 0,
        results: [{ transaction_id: TXN, ok: true, undo_kind: "reassign" }],
      },
    },
  }));
  const batch = await callTool("assign_expenses", {
    idempotency_key: "batch-1",
    items: [{
      transaction_id: TXN,
      project_id: PROJECT,
      category_id: CATEGORY,
    }],
  }, ["write"], rpc);
  assertEquals(batch.isError, false);
  assertEquals(calls[0], {
    name: "mcp_assign_expenses",
    body: {
      p_idempotency_key: "batch-1",
      p_items: [{
        transaction_id: TXN,
        project_id: PROJECT,
        category_id: CATEGORY,
      }],
    },
  });
  if (batch.structuredContent.ok) {
    assertEquals((batch.structuredContent.data as { batch_key: string }).batch_key, BATCH_KEY);
  }
  const undo = await callTool("undo_batch", {
    idempotency_key: "undo-batch-1",
    batch_key: BATCH_KEY,
  }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls[1], {
    name: "mcp_undo_batch",
    body: { p_idempotency_key: "undo-batch-1", p_batch_key: BATCH_KEY },
  });
  const { calls: deniedCalls, rpc: deniedRpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const readDenied = await callTool("assign_expenses", {
    idempotency_key: "batch-1",
    items: [{ transaction_id: TXN, category_id: CATEGORY }],
  }, ["read"], deniedRpc);
  assertEquals(readDenied.isError, true);
  if (!readDenied.structuredContent.ok) assertEquals(readDenied.structuredContent.error.code, "forbidden");
  assertEquals(deniedCalls.length, 0);
  const tooMany = Array.from({ length: 201 }, (_, index) => ({
    transaction_id: `11111111-1111-4000-8000-${String(index).padStart(12, "0")}`,
    category_id: CATEGORY,
  }));
  const cases = [
    callTool("assign_expenses", { idempotency_key: "k", items: [] }, ["write"], rpc),
    callTool("assign_expenses", { idempotency_key: "k", items: tooMany }, ["write"], rpc),
    callTool("assign_expenses", {
      idempotency_key: "k",
      items: [
        { transaction_id: TXN, category_id: CATEGORY },
        { transaction_id: TXN, category_id: CATEGORY },
      ],
    }, ["write"], rpc),
    callTool("assign_expenses", {
      idempotency_key: "k",
      items: [{ transaction_id: TXN }],
    }, ["write"], rpc),
    callTool("assign_expenses", {
      idempotency_key: "k",
      items: [{ transaction_id: TXN, project_id: PROJECT }],
    }, ["write"], rpc),
    callTool("assign_expenses", {
      idempotency_key: "k",
      items: [{ transaction_id: TXN, category_id: CATEGORY, company_id: "forged" }],
    }, ["write"], rpc),
    callTool("assign_expenses", {
      idempotency_key: "k",
      items: [{ transaction_id: TXN, category_id: CATEGORY, extra: true }],
    }, ["write"], rpc),
    callTool("assign_expenses", {
      idempotency_key: "k".repeat(125),
      items: [{ transaction_id: TXN, category_id: CATEGORY }],
    }, ["write"], rpc),
    callTool("undo_batch", { idempotency_key: "k".repeat(125), batch_key: BATCH_KEY }, ["write"], rpc),
  ];
  for (const pending of cases) {
    const result = await pending;
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
});

Deno.test("assign_expenses forwards split rows next to plain rows and validates them", async () => {
  const TXN_B = "22222222-2222-4000-8000-000000000021";
  const shares = [{ project_id: PROJECT, share: 50 }, { project_id: PROJECT_B, share: 50 }];
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: {
      ok: true,
      data: {
        batch_key: BATCH_KEY,
        ok_count: 1,
        error_count: 1,
        results: [
          { transaction_id: TXN, ok: true, undo_kind: "review", closed_review: true },
          { transaction_id: TXN_B, ok: false, code: "refused" },
        ],
      },
    },
  }));
  const items = [
    { transaction_id: TXN, category_id: CATEGORY, shares },
    { transaction_id: TXN_B, project_id: PROJECT, category_id: CATEGORY },
  ];
  const batch = await callTool("assign_expenses", { idempotency_key: "batch-split-1", items }, ["write"], rpc);
  assertEquals(batch.isError, false, "partial success is still a tool success");
  assertEquals(calls[0], {
    name: "mcp_assign_expenses",
    body: { p_idempotency_key: "batch-split-1", p_items: items },
  });
  assertEquals(batch.structuredContent.ok, true);
  if (batch.structuredContent.ok) {
    const data = batch.structuredContent.data as { results: { closed_review?: boolean; code?: string }[] };
    assertEquals(data.results.map((row) => row.closed_review), [true, undefined]);
    assertEquals(data.results[1].code, "refused");
  }
  const splitOnly = await callTool("assign_expenses", {
    idempotency_key: "batch-split-2",
    items: [{ transaction_id: TXN, shares }],
  }, ["write"], rpc);
  assertEquals(splitOnly.isError, false, "a split row needs no category_id");

  const { calls: deniedCalls, rpc: deniedRpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const readDenied = await callTool("assign_expenses", {
    idempotency_key: "batch-split-1",
    items: [{ transaction_id: TXN, shares }],
  }, ["read"], deniedRpc);
  assertEquals(readDenied.isError, true);
  if (!readDenied.structuredContent.ok) assertEquals(readDenied.structuredContent.error.code, "forbidden");
  assertEquals(deniedCalls.length, 0);

  const bad = [
    { transaction_id: TXN, shares: [{ project_id: PROJECT, share: 100 }] },
    { transaction_id: TXN, shares: [{ project_id: PROJECT, share: 40 }, { project_id: PROJECT_B, share: 50 }] },
    { transaction_id: TXN, shares: [{ project_id: PROJECT, share: 50 }, { project_id: PROJECT, share: 50 }] },
    { transaction_id: TXN, shares: [{ project_id: PROJECT, share: 50.5 }, { project_id: PROJECT_B, share: 49.5 }] },
    { transaction_id: TXN, shares: [{ project_id: PROJECT, share: 0 }, { project_id: PROJECT_B, share: 100 }] },
    { transaction_id: TXN, shares: [{ project_id: PROJECT, share: 50, extra: 1 }, { project_id: PROJECT_B, share: 50 }] },
    { transaction_id: TXN, shares: { project_id: PROJECT, share: 100 } },
    { transaction_id: TXN, project_id: PROJECT, category_id: CATEGORY, shares },
    { transaction_id: TXN, remember: false, shares },
  ];
  const before = calls.length;
  for (const item of bad) {
    const result = await callTool("assign_expenses", { idempotency_key: "k", items: [item] }, ["write"], rpc);
    assertEquals(result.isError, true, JSON.stringify(item));
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before, "a bad split row never reaches the database");
});

Deno.test("assign_expenses lowercases ids and refuses remember on a category-only row (FLOW-205)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { batch_key: "b", ok_count: 1, results: [] } } }));
  const upper = await callTool("assign_expenses", {
    idempotency_key: "batch-case-1",
    items: [{ transaction_id: TXN.toUpperCase(), project_id: PROJECT.toUpperCase(), category_id: CATEGORY.toUpperCase(), remember: true }],
  }, ["write"], rpc);
  assertEquals(upper.isError, false);
  assertEquals(calls[0]?.body.p_items, [{ transaction_id: TXN, project_id: PROJECT, category_id: CATEGORY, remember: true }]);

  for (const items of [
    [{ transaction_id: TXN, category_id: CATEGORY, remember: true }],
    [{ transaction_id: TXN, project_id: PROJECT, category_id: CATEGORY }, { transaction_id: TXN.toUpperCase(), category_id: CATEGORY }],
  ]) {
    const refused = await callTool("assign_expenses", { idempotency_key: "k", items }, ["write"], rpc);
    assertEquals(refused.isError, true, JSON.stringify(items));
    if (!refused.structuredContent.ok) assertEquals(refused.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 1, "a refused call never reaches the database");
  const off = await callTool("assign_expenses", {
    idempotency_key: "batch-case-2",
    items: [{ transaction_id: TXN, category_id: CATEGORY, remember: false }],
  }, ["write"], rpc);
  assertEquals(off.isError, false, "remember: false on a category-only row is allowed");
});

Deno.test("assign_expenses lists shares[] on its items like assign_expense_split", () => {
  const tools = toolsFor(["write"]);
  const batch = tools.find((tool) => tool.name === "assign_expenses");
  const single = tools.find((tool) => tool.name === "assign_expense_split");
  const props = batch?.inputSchema.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>;
  const itemProps = props.items.items?.properties ?? {};
  assertEquals(Object.keys(itemProps), ["transaction_id", "project_id", "category_id", "remember", "shares", "parts"]);
  assertEquals(itemProps.shares, (single?.inputSchema.properties as Record<string, unknown>).shares);
  assertEquals(itemProps.shares, {
    type: "array",
    items: {
      type: "object",
      properties: { project_id: { type: "string" }, share: { type: "integer" } },
      required: ["project_id", "share"],
      additionalProperties: false,
    },
  });
  assertEquals(batch?.description.includes("shares[]"), true);
});

Deno.test("assign_expenses forwards a parts[] row like split_line and validates it the same way", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: {
      ok: true,
      data: {
        batch_key: BATCH_KEY,
        ok_count: 1,
        error_count: 0,
        results: [{ transaction_id: TXN, ok: true, undo_kind: "line_split" }],
      },
    },
  }));
  const TXN_B = "22222222-2222-4000-8000-000000000021";
  const parts = [
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 4000 },
    { category_id: CATEGORY, project_id: null, rest: true },
  ];
  const batch = await callTool("assign_expenses", {
    idempotency_key: "batch-parts",
    items: [{ transaction_id: TXN, parts }, { transaction_id: TXN_B, parts: [] }],
  }, ["write"], rpc);
  assertEquals(batch.isError, false);
  assertEquals(calls[0], {
    name: "mcp_assign_expenses",
    body: {
      p_idempotency_key: "batch-parts",
      p_items: [{ transaction_id: TXN, parts }, { transaction_id: TXN_B, parts: [] }],
    },
  });
  const before = calls.length;
  const bad = [
    [{ category_id: CATEGORY, amount_minor: 4000 }],
    [{ category_id: CATEGORY, rest: true }, { category_id: PROJECT, rest: true }],
    [{ category_id: CATEGORY, amount_minor: 1 }, { category_id: CATEGORY, amount_minor: 2 }],
    [{ category_id: CATEGORY, amount_minor: 1, share: 1 }, { category_id: PROJECT, amount_minor: 2 }],
    Array.from({ length: 51 }, (_, i) => ({
      category_id: CATEGORY,
      project_id: `8c1a0b2e-1111-4000-8000-${String(i).padStart(12, "0")}`,
      amount_minor: i + 1,
    })),
  ];
  for (const rows of bad) {
    const refused = await callTool("assign_expenses", {
      idempotency_key: "k",
      items: [{ transaction_id: TXN, parts: rows }],
    }, ["write"], rpc);
    assertEquals(refused.isError, true);
  }
  for (const extra of [{ category_id: CATEGORY }, { project_id: PROJECT }, { remember: true }, { shares: [] }]) {
    const refused = await callTool("assign_expenses", {
      idempotency_key: "k",
      items: [{ transaction_id: TXN, parts: [], ...extra }],
    }, ["write"], rpc);
    assertEquals(refused.isError, true);
  }
  assertEquals(calls.length, before, "a bad parts row never reaches the database");
  const tools = toolsFor(["write"]);
  const batchTool = tools.find((tool) => tool.name === "assign_expenses");
  const single = tools.find((tool) => tool.name === "split_line");
  const props = batchTool?.inputSchema.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>;
  assertEquals(props.items.items?.properties?.parts, (single?.inputSchema.properties as Record<string, unknown>).parts);
});

Deno.test("set_category_pnl validates, forwards p_* args, and undo accepts category_pnl", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { id: CATEGORY, undo_kind: "category_pnl" } },
  }));
  const ok = await callTool("set_category_pnl", {
    idempotency_key: "pnl-1",
    category_id: CATEGORY,
    excluded: true,
  }, ["write"], rpc);
  assertEquals(ok.isError, false);
  assertEquals(calls[0], {
    name: "mcp_set_category_pnl",
    body: {
      p_idempotency_key: "pnl-1",
      p_category_id: CATEGORY,
      p_excluded: true,
    },
  });
  const badKey = await callTool("set_category_pnl", {
    idempotency_key: "pnl-1",
    category_id: CATEGORY,
    company_id: "forged",
    excluded: true,
  }, ["write"], rpc);
  assertEquals(badKey.isError, true);
  const badExcluded = await callTool("set_category_pnl", {
    idempotency_key: "pnl-2",
    category_id: CATEGORY,
    excluded: "yes",
  }, ["write"], rpc);
  assertEquals(badExcluded.isError, true);
  const undo = await callTool("undo", {
    idempotency_key: "pnl-undo",
    kind: "category_pnl",
    id: CATEGORY,
  }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls[1]?.name, "mcp_undo");
});

Deno.test("list_categories passes excluded_from_pnl and get_totals copies excluded agorot", async () => {
  const dashboard = {
    company_id: "company-a",
    name: "Example Holdings LLC",
    basis: "cash",
    income_agorot: 1,
    direct_agorot: 0,
    shared_agorot: 0,
    overhead_agorot: 0,
    expense_agorot: 0,
    net_profit_agorot: 1,
    excluded_income_agorot: 2,
    excluded_expense_agorot: 3,
    active_projects: 1,
    review_count: 0,
    by_currency: [{
      currency: "ILS",
      income_minor: 1,
      direct_minor: 0,
      shared_minor: 0,
      overhead_minor: 0,
      expense_minor: 0,
      net_profit_minor: 1,
      excluded_income_minor: 2,
      excluded_expense_minor: 3,
      excluded_count: 1,
      count: 1,
    }],
  };
  const { rpc } = rpcOf((name) => {
    if (name === "get_dashboard") return { status: 200, json: dashboard };
    if (name === "list_categories") {
      return {
        status: 200,
        json: [{ id: "c1", name: "Materials", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: null }],
      };
    }
    return { status: 500, json: null };
  });
  const listed = await callTool("list_categories", {}, ["read"], rpc);
  assertEquals(listed.isError, false);
  if (listed.structuredContent.ok) {
    const rows = (listed.structuredContent.data as { categories: { excluded_from_pnl: boolean | null }[] }).categories;
    assertEquals(rows[0]?.excluded_from_pnl, null);
  }
  const totals = await callTool("get_totals", {}, ["read"], rpc);
  assertEquals(totals.isError, false);
  if (totals.structuredContent.ok) {
    const data = totals.structuredContent.data as {
      excluded_income_agorot: number;
      excluded_expense_agorot: number;
      by_currency: { excluded_income_minor: number }[];
    };
    assertEquals(data.excluded_income_agorot, 2);
    assertEquals(data.excluded_expense_agorot, 3);
    assertEquals(data.by_currency[0]?.excluded_income_minor, 2);
  }
});

Deno.test("set_category_pnl forwards excluded false, rejects bad input, and refuses a read token", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { id: CATEGORY, undo_kind: "category_pnl" } },
  }));
  const back = await callTool("set_category_pnl", {
    idempotency_key: "pnl-back",
    category_id: CATEGORY,
    excluded: false,
  }, ["write"], rpc);
  assertEquals(back.isError, false);
  assertEquals(calls[0], {
    name: "mcp_set_category_pnl",
    body: {
      p_idempotency_key: "pnl-back",
      p_category_id: CATEGORY,
      p_excluded: false,
    },
  });
  const cases = [
    callTool("set_category_pnl", { category_id: CATEGORY, excluded: true }, ["write"], rpc),
    callTool("set_category_pnl", { idempotency_key: "k", excluded: true }, ["write"], rpc),
    callTool("set_category_pnl", { idempotency_key: "k", category_id: CATEGORY }, ["write"], rpc),
    callTool("set_category_pnl", { idempotency_key: "k", category_id: "not-a-uuid", excluded: true }, ["write"], rpc),
    callTool("set_category_pnl", { idempotency_key: "k", category_id: CATEGORY, excluded: true, hidden: true }, ["write"], rpc),
  ];
  for (const result of await Promise.all(cases)) {
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  const denied = await callTool("set_category_pnl", {
    idempotency_key: "pnl-read",
    category_id: CATEGORY,
    excluded: true,
  }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  assertEquals(calls.length, 1);
});

Deno.test("rename_company trims, counts code points, refuses control characters and a read token, and undo accepts company", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { id: PROJECT, name: "Example North", prior_name: "Example Co", undo_kind: "company" } },
  }));
  const renamed = await callTool("rename_company", {
    idempotency_key: "rename-1",
    name: "  Example North  ",
  }, ["write"], rpc);
  assertEquals(renamed.isError, false);
  assertEquals(calls[0], {
    name: "mcp_rename_company",
    body: { p_idempotency_key: "rename-1", p_name: "Example North" },
  });
  const cases = [
    callTool("rename_company", { name: "Example North" }, ["write"], rpc),
    callTool("rename_company", { idempotency_key: "k" }, ["write"], rpc),
    callTool("rename_company", { idempotency_key: "k", name: " x " }, ["write"], rpc),
    callTool("rename_company", { idempotency_key: "k", name: "a".repeat(101) }, ["write"], rpc),
    callTool("rename_company", { idempotency_key: "k", name: 42 }, ["write"], rpc),
    callTool("rename_company", { idempotency_key: "k", name: "Example North", company_id: PROJECT }, ["write"], rpc),
    callTool("rename_company", { idempotency_key: "k", name: "Example\u0007North" }, ["write"], rpc),
    callTool("rename_company", { idempotency_key: "k", name: "Example\u0085North" }, ["write"], rpc),
    callTool("rename_company", { idempotency_key: "k", name: "\u{1F600}".repeat(101) }, ["write"], rpc),
    callTool("rename_company", { idempotency_key: "k", name: "\u00a0x\u3000" }, ["write"], rpc),
  ];
  for (const result of await Promise.all(cases)) {
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  // Code points, like char_length: 100 emoji are 200 UTF-16 units and still pass.
  const emoji = await callTool("rename_company", { idempotency_key: "rename-emoji", name: "\u{1F600}".repeat(100) }, ["write"], rpc);
  assertEquals(emoji.isError, false);
  // trim() strips every whitespace, as private.trim_name does in SQL.
  const spaced = await callTool("rename_company", {
    idempotency_key: "rename-spaced",
    name: "\u00a0\tExample North\u2003\ufeff",
  }, ["write"], rpc);
  assertEquals(spaced.isError, false);
  assertEquals(calls[2].body, { p_idempotency_key: "rename-spaced", p_name: "Example North" });
  const denied = await callTool("rename_company", { idempotency_key: "rename-read", name: "Example North" }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  assertEquals(calls.length, 3);
  const undo = await callTool("undo", { idempotency_key: "rename-undo", kind: "company", id: PROJECT }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls[3], {
    name: "mcp_undo",
    body: { p_idempotency_key: "rename-undo", p_kind: "company", p_id: PROJECT },
  });
});

const PROJECT_FIXTURE = {
  id: PROJECT,
  name: "Example Site",
  status: "active",
  state_label: null,
  budget_agorot: null,
  sumit_budget_section_id: null,
  after_overhead: false,
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  by_currency: [{ currency: "USD", income_minor: 250000, direct_minor: 1250, shared_minor: 0, profit_minor: 248750 }],
  categories: [],
  categories_by_currency: [
    { currency: "USD", id: CATEGORY, name: "Example Supplies", amount_minor: 1250, has_shared_share: false },
    { currency: "USD", id: null, name: null, amount_minor: 0, has_shared_share: null },
  ],
  excluded_categories_by_currency: [
    { currency: "USD", id: CATEGORY_NEW, name: "Example Loan Principal", amount_minor: 50000, has_shared_share: false },
  ],
  excluded_income_by_currency: [
    { currency: "USD", id: CATEGORY, name: "Example Owner Money", amount_minor: 3000, count: 1 },
  ],
  other_currencies: [{ currency: "USD", income_minor: 250000, expense_minor: -1250, count: 2 }],
  pending_count: 0,
  pending_agorot: 0,
  pending_other_currencies: [],
  transactions: [
    {
      id: INCOME_TXN,
      description: "Example deposit",
      doc_date: "2026-09-02",
      amount_net: 250000,
      currency: "USD",
      direction: "income",
      source: "mercury",
      doc_kind: "invoice_receipt",
      category: null,
    },
    {
      id: TXN,
      description: null,
      doc_date: "2026-09-01",
      amount_net: -1250,
      currency: "USD",
      direction: "expense",
      source: "manual",
      doc_kind: "expense",
      category: "Example Supplies",
    },
  ],
  profit_agorot: 0,
  overhead_share_agorot: null,
  overhead_weighted: false,
  profit_after_overhead_agorot: 0,
};

Deno.test("get_project is listed for a read scope only, as a read", () => {
  const readNames = toolsFor(["read"]).map((tool) => tool.name);
  assertEquals(readNames.includes("get_project"), true);
  assertEquals(toolsFor(["write"]).map((tool) => tool.name).includes("get_project"), false);
  const spec = toolsFor(["read"]).find((tool) => tool.name === "get_project");
  assertEquals(spec?.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true });
  assertEquals(spec?.inputSchema, {
    type: "object",
    properties: {
      id: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
      from: { type: "string" },
      to: { type: "string" },
    },
    additionalProperties: false,
  });
  assertEquals(spec?.description.includes("cash"), true);
});

Deno.test("get_project passes a period, both dates or neither", async () => {
  const { calls, rpc } = rpcOf((name) => name === "get_project" ? { status: 200, json: PROJECT_FIXTURE } : { status: 500, json: null });
  const result = await callTool("get_project", { id: PROJECT, basis: "invoiced", from: "2026-08-01", to: "2026-08-31" }, ["read"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls, [{ name: "get_project", body: { p_id: PROJECT, p_basis: "invoiced", p_from: "2026-08-01", p_to: "2026-08-31" } }]);
  for (const args of [
    { id: PROJECT, to: "2026-08-31" },
    { id: PROJECT, from: "2026-09-01", to: "2026-08-31" },
    { id: PROJECT, from: "2026-8-1", to: "2026-08-31" },
  ]) {
    const refused = await callTool("get_project", args, ["read"], rpc);
    assertEquals(refused.isError, true);
    if (!refused.structuredContent.ok) assertEquals(refused.structuredContent.error, { code: "validation", message: "validation" });
  }
  assertEquals(calls.length, 1);
});

Deno.test("get_profit_months reads the company or one project by month", async () => {
  const months = { basis: "cash", months: [{ month: "2026-09", by_currency: [{ currency: "ILS", income_minor: 100, expense_minor: 40, profit_minor: 60 }] }], by_currency: [] };
  const { calls, rpc } = rpcOf((name, body) => name !== "get_profit_months"
    ? { status: 500, json: null }
    : body.p_project_id === PROJECT_B ? { status: 200, json: null } : { status: 200, json: months });
  const company = await callTool("get_profit_months", { from: "2026-07-01", to: "2026-09-30" }, ["read"], rpc);
  assertEquals(company.isError, false);
  if (company.structuredContent.ok) assertEquals(company.structuredContent.data, months);
  const project = await callTool("get_profit_months", { project_id: PROJECT, basis: "invoiced" }, ["read"], rpc);
  assertEquals(project.isError, false);
  const missing = await callTool("get_profit_months", { project_id: PROJECT_B }, ["read"], rpc);
  assertEquals(missing.isError, true);
  if (!missing.structuredContent.ok) assertEquals(missing.structuredContent.error.code, "not_found");
  assertEquals(calls.map((call) => call.body), [
    { p_from: "2026-07-01", p_to: "2026-09-30", p_basis: "cash", p_project_id: null },
    { p_from: null, p_to: null, p_basis: "invoiced", p_project_id: PROJECT },
    { p_from: null, p_to: null, p_basis: "cash", p_project_id: PROJECT_B },
  ]);
});

Deno.test("get_profit_months rejects bad arguments before any read", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: {} }));
  for (const args of [
    { from: "2026-07-01" },
    { from: "2026-09-01", to: "2026-08-31" },
    { from: "2006-01-01", to: "2026-01-01" },
    { basis: "accrual" },
    { project_id: "not-a-uuid" },
    { project_id: PROJECT, company_id: "other" },
  ]) {
    const result = await callTool("get_profit_months", args, ["read"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error, { code: "validation", message: "validation" });
  }
  assertEquals(calls.length, 0);
  assertEquals((await callTool("get_profit_months", { from: "2006-02-01", to: "2026-01-31" }, ["read"], rpc)).isError, false);
});

Deno.test("get_project calls get_project with the id and each basis", async () => {
  for (const basis of ["cash", "invoiced"]) {
    const { calls, rpc } = rpcOf((name) => name === "get_project" ? { status: 200, json: PROJECT_FIXTURE } : { status: 500, json: null });
    const result = await callTool("get_project", { id: PROJECT, basis }, ["read"], rpc);
    assertEquals(result.isError, false);
    assertEquals(calls, [{ name: "get_project", body: { p_id: PROJECT, p_basis: basis } }]);
    if (result.structuredContent.ok) {
      const data = result.structuredContent.data as typeof PROJECT_FIXTURE & { basis: string };
      assertEquals(data.basis, basis);
      assertEquals(data.id, PROJECT);
      assertEquals(data.by_currency, PROJECT_FIXTURE.by_currency);
      assertEquals(data.categories_by_currency, PROJECT_FIXTURE.categories_by_currency);
      assertEquals(data.excluded_categories_by_currency, PROJECT_FIXTURE.excluded_categories_by_currency);
      assertEquals(data.excluded_categories_by_currency[0]?.amount_minor, 50000);
      assertEquals(data.excluded_income_by_currency, PROJECT_FIXTURE.excluded_income_by_currency);
      assertEquals(data.transactions, PROJECT_FIXTURE.transactions);
      assertEquals(data.transactions.map((row) => row.currency), ["USD", "USD"]);
      assertEquals(data.budget_agorot, null);
      assertEquals(data.overhead_share_agorot, null);
    }
  }
});

Deno.test("get_project defaults to the cash basis, like list_projects and get_totals", async () => {
  const { calls, rpc } = rpcOf((name) => name === "get_project" || name === "get_dashboard"
    ? { status: 200, json: name === "get_project" ? PROJECT_FIXTURE : { projects: [], basis: "cash" } }
    : { status: 500, json: null });
  const project = await callTool("get_project", { id: PROJECT }, ["read"], rpc);
  const nullBasis = await callTool("get_project", { id: PROJECT, basis: null }, ["read"], rpc);
  await callTool("list_projects", {}, ["read"], rpc);
  assertEquals(project.isError, false);
  assertEquals(nullBasis.isError, false);
  assertEquals(calls[0], { name: "get_project", body: { p_id: PROJECT, p_basis: "cash" } });
  assertEquals(calls[1], { name: "get_project", body: { p_id: PROJECT, p_basis: "cash" } });
  assertEquals(calls[2]?.body.p_basis, calls[0]?.body.p_basis);
  if (project.structuredContent.ok) assertEquals((project.structuredContent.data as { basis: string }).basis, "cash");
});

Deno.test("get_project rejects a bad id, a bad basis, and an extra argument before any read", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: PROJECT_FIXTURE }));
  const cases = [
    callTool("get_project", {}, ["read"], rpc),
    callTool("get_project", { id: "not-a-uuid" }, ["read"], rpc),
    callTool("get_project", { id: 42 }, ["read"], rpc),
    callTool("get_project", { id: `${PROJECT}x` }, ["read"], rpc),
    callTool("get_project", { id: PROJECT, basis: "accrual" }, ["read"], rpc),
    callTool("get_project", { id: PROJECT, basis: "CASH" }, ["read"], rpc),
    callTool("get_project", { id: PROJECT, basis: 1 }, ["read"], rpc),
    callTool("get_project", { id: PROJECT, from: "2026-09-01" }, ["read"], rpc),
    callTool("get_project", { id: PROJECT, project_id: PROJECT }, ["read"], rpc),
    callTool("get_project", { id: PROJECT, company_id: "other" }, ["read"], rpc),
    callTool("get_project", { id: PROJECT, user_id: "other" }, ["read"], rpc),
    callTool("get_project", [PROJECT], ["read"], rpc),
    callTool("get_project", "x", ["read"], rpc),
  ];
  for (const pending of cases) {
    const result = await pending;
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) {
      assertEquals(result.structuredContent.error, { code: "validation", message: "validation" });
    }
  }
  assertEquals(calls.length, 0);
});

Deno.test("get_project maps an RPC error to a read refusal and null to not found", async () => {
  for (const status of [400, 401, 403, 404, 500]) {
    const result = await callTool("get_project", { id: PROJECT }, ["read"], () => Promise.resolve({ status, json: { message: "permission denied" } }));
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) {
      assertEquals(result.structuredContent.error, { code: "refused", message: "The read was refused." });
    }
  }
  const missing = await callTool("get_project", { id: PROJECT }, ["read"], () => Promise.resolve({ status: 200, json: null }));
  assertEquals(missing.isError, true);
  if (!missing.structuredContent.ok) assertEquals(missing.structuredContent.error, { code: "not_found", message: "not found" });
  for (const json of [[PROJECT_FIXTURE], "x", 1]) {
    const odd = await callTool("get_project", { id: PROJECT }, ["read"], () => Promise.resolve({ status: 200, json }));
    assertEquals(odd.isError, true);
    if (!odd.structuredContent.ok) assertEquals(odd.structuredContent.error.code, "refused");
  }
});

Deno.test("get_project needs the read scope", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: PROJECT_FIXTURE }));
  const result = await callTool("get_project", { id: PROJECT }, ["write"], rpc);
  assertEquals(result.isError, true);
  if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "forbidden");
  const none = await callTool("get_project", { id: PROJECT }, [], rpc);
  assertEquals(none.isError, true);
  if (!none.structuredContent.ok) assertEquals(none.structuredContent.error.code, "forbidden");
  assertEquals(calls.length, 0);
});

Deno.test("set_overhead_project forwards a project or null, rejects bad input, and undo accepts overhead_project", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { id: "company-a", overhead_project_id: PROJECT, undo_kind: "overhead_project" } },
  }));
  const set = await callTool("set_overhead_project", { idempotency_key: "oh-1", project_id: PROJECT }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls[0], {
    name: "mcp_set_overhead_project",
    body: { p_idempotency_key: "oh-1", p_project_id: PROJECT },
  });
  const cleared = await callTool("set_overhead_project", { idempotency_key: "oh-2", project_id: null }, ["write"], rpc);
  assertEquals(cleared.isError, false);
  assertEquals(calls[1], {
    name: "mcp_set_overhead_project",
    body: { p_idempotency_key: "oh-2", p_project_id: null },
  });
  for (
    const bad of [
      { idempotency_key: "oh-3" },
      { project_id: PROJECT },
      { idempotency_key: "oh-4", project_id: "not-a-uuid" },
      { idempotency_key: "oh-5", project_id: PROJECT, company_id: "forged" },
    ]
  ) {
    assertEquals((await callTool("set_overhead_project", bad, ["write"], rpc)).isError, true);
  }
  assertEquals(calls.length, 2, "bad input never reaches the RPC");
  const readOnly = await callTool("set_overhead_project", { idempotency_key: "oh-6", project_id: PROJECT }, ["read"], rpc);
  assertEquals(readOnly.isError, true);
  const undo = await callTool("undo", { idempotency_key: "oh-undo", kind: "overhead_project", id: PROJECT_B }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls[2]?.name, "mcp_undo");
  assertEquals(calls[2]?.body?.p_kind, "overhead_project");
});

Deno.test("get_totals and list_projects carry the unassigned bucket and the overhead project", async () => {
  const dashboard = {
    company_id: "company-a",
    name: "Example Holdings LLC",
    basis: "cash",
    income_agorot: 30000,
    direct_agorot: 5000,
    shared_agorot: 0,
    overhead_agorot: 2000,
    expense_agorot: 8000,
    unassigned_income_agorot: 10000,
    unassigned_expense_agorot: 1000,
    overhead_project_id: PROJECT_B,
    net_profit_agorot: 22000,
    by_currency: [{ currency: "ILS", unassigned_income_minor: 10000, unassigned_expense_minor: 1000 }],
    projects: [
      { id: PROJECT, name: "Site Alpha", is_overhead: false, by_currency: [] },
      { id: PROJECT_B, name: "Office", is_overhead: true, by_currency: [] },
    ],
  };
  const { rpc } = rpcOf((name) => name === "get_dashboard" ? { status: 200, json: dashboard } : { status: 500, json: null });
  const totals = await callTool("get_totals", {}, ["read"], rpc);
  assertEquals(totals.isError, false);
  if (totals.structuredContent.ok) {
    const data = totals.structuredContent.data as Record<string, unknown>;
    assertEquals(data.unassigned_income_agorot, 10000);
    assertEquals(data.unassigned_expense_agorot, 1000);
    assertEquals(data.overhead_project_id, PROJECT_B);
    assertEquals((data.by_currency as Record<string, unknown>[])[0]?.unassigned_expense_minor, 1000);
  }
  const listed = await callTool("list_projects", {}, ["read"], rpc);
  assertEquals(listed.isError, false);
  if (listed.structuredContent.ok) {
    const rows = (listed.structuredContent.data as { projects: { is_overhead: boolean }[] }).projects;
    assertEquals(rows.map((row) => row.is_overhead), [false, true]);
  }
});

Deno.test("get_totals does not report a missing unassigned bucket as 0", async () => {
  const { rpc } = rpcOf((name) =>
    name === "get_dashboard"
      ? { status: 200, json: { company_id: "company-a", basis: "cash", income_agorot: 1000, expense_agorot: 0, by_currency: [] } }
      : { status: 500, json: null }
  );
  const totals = await callTool("get_totals", {}, ["read"], rpc);
  assertEquals(totals.isError, false);
  if (totals.structuredContent.ok) {
    const data = totals.structuredContent.data as Record<string, unknown>;
    assertEquals(data.unassigned_income_agorot, undefined);
    assertEquals(data.unassigned_expense_agorot, undefined);
  }
});

Deno.test("get_breakdown calls the group totals, then a group's lines, and checks its arguments", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_breakdown") {
      return { status: 200, json: { direction: "expense", totals: [], groups: [], excluded: [], review_count: 0 } };
    }
    if (name === "mcp_company_loan_currency") return { status: 200, json: "USD" };
    return { status: 200, json: { rows: [], has_more: false } };
  });
  const groups = await callTool("get_breakdown", { direction: "expense" }, ["read"], rpc);
  assertEquals(groups.isError, false);
  assertEquals(calls[0], {
    name: "get_breakdown",
    body: { p_direction: "expense", p_from: null, p_to: null, p_group_by: "category", p_basis: "cash" },
  });

  const lines = await callTool("get_breakdown", {
    direction: "income",
    group_by: "project",
    group: "unassigned",
    currency: "USD",
    from: "2026-06-01",
    to: "2026-06-30",
    basis: "invoiced",
    limit: 10,
    offset: 20,
  }, ["read"], rpc);
  assertEquals(lines.isError, false);
  assertEquals(calls[1], {
    name: "get_breakdown_lines",
    body: {
      p_direction: "income",
      p_from: "2026-06-01",
      p_to: "2026-06-30",
      p_group_by: "project",
      p_basis: "invoiced",
      p_group_key: "unassigned",
      p_currency: "USD",
      p_excluded: false,
      p_limit: 10,
      p_offset: 20,
    },
  });

  const kept = await callTool("get_breakdown", { direction: "expense", excluded: true }, ["read"], rpc);
  assertEquals(kept.isError, false);
  assertEquals(calls[2]?.name, "mcp_company_loan_currency", "no currency reads the company currency (FLOW-504)");
  assertEquals(calls[3]?.name, "get_breakdown_lines");
  assertEquals(calls[3]?.body.p_excluded, true);
  assertEquals(calls[3]?.body.p_group_key, null);
  assertEquals(calls[3]?.body.p_currency, "USD");

  const before = calls.length;
  for (const bad of [
    {},
    { direction: "both" },
    { direction: "expense", group_by: "week" },
    { direction: "expense", basis: "accrual" },
    { direction: "expense", from: "06-01" },
    { direction: "expense", currency: "USD" },
    { direction: "expense", group: "x", currency: "usd" },
    { direction: "expense", group: "x", limit: 500 },
    { direction: "expense", excluded: "yes" },
    { direction: "expense", from: "2026-06-01" },
    { direction: "expense", to: "2026-06-30" },
    { direction: "expense", excluded: true, group: "x" },
    { direction: "expense", company_id: "x" },
  ]) {
    const result = await callTool("get_breakdown", bad, ["read"], rpc);
    assertEquals(result.isError, true, JSON.stringify(bad));
  }
  assertEquals(calls.length, before, "a bad argument never reaches the database");

  const denied = await callTool("get_breakdown", { direction: "expense" }, ["write"], rpc);
  assertEquals(denied.isError, true, "a write-only token cannot read");
});

Deno.test("add_loan forwards project_id only when given and rejects a bad one", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "mcp_add_loan") return { status: 200, json: { ok: true, data: { id: LOAN, project_id: PROJECT, undo_kind: "loan" } } };
    return { status: 500, json: null };
  });
  const base = {
    name: "Example Bank",
    principal: "100000.00",
    annual_rate_percent: 6,
    term_months: 120,
    start_date: "2026-01-01",
    payment: "2000.00",
    currency: "USD",
  };
  const withProject = await callTool("add_loan", { ...base, idempotency_key: "lp-1", project_id: PROJECT }, ["write"], rpc);
  assertEquals(withProject.isError, false);
  assertEquals(calls[0]?.name, "mcp_add_loan");
  assertEquals(calls[0]?.body.p_project_id, PROJECT);
  if (withProject.structuredContent.ok) {
    assertEquals((withProject.structuredContent.data as { project_id: string }).project_id, PROJECT);
  }
  const without = await callTool("add_loan", { ...base, idempotency_key: "lp-2" }, ["write"], rpc);
  assertEquals(without.isError, false);
  assertEquals("p_project_id" in (calls[1]?.body ?? {}), false);
  for (const bad of ["not-a-uuid", 5, null, `${PROJECT}x`]) {
    const out = await callTool("add_loan", { ...base, idempotency_key: "lp-3", project_id: bad }, ["write"], rpc);
    assertEquals(out.isError, true);
    if (!out.structuredContent.ok) assertEquals(out.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 2);
});

Deno.test("update_loan sends project_id as a uuid, as null, or not at all", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "mcp_update_loan") return { status: 200, json: { ok: true, data: { id: LOAN, undo_kind: "loan_update" } } };
    return { status: 500, json: null };
  });
  const set = await callTool("update_loan", { idempotency_key: "lp-u1", loan_id: LOAN, project_id: PROJECT }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls[0]?.body.p_patch, { project_id: PROJECT });
  const cleared = await callTool("update_loan", { idempotency_key: "lp-u2", loan_id: LOAN, project_id: null }, ["write"], rpc);
  assertEquals(cleared.isError, false);
  assertEquals(calls[1]?.body.p_patch, { project_id: null });
  assertEquals("project_id" in (calls[1]?.body.p_patch as Record<string, unknown>), true);
  const left = await callTool("update_loan", { idempotency_key: "lp-u3", loan_id: LOAN, name: "Renamed" }, ["write"], rpc);
  assertEquals(left.isError, false);
  assertEquals(calls[2]?.body.p_patch, { name: "Renamed" });
  assertEquals("project_id" in (calls[2]?.body.p_patch as Record<string, unknown>), false);
  const empty = await callTool("update_loan", { idempotency_key: "lp-u4", loan_id: LOAN }, ["write"], rpc);
  assertEquals(empty.isError, true);
  for (const bad of ["not-a-uuid", 5, true]) {
    const out = await callTool("update_loan", { idempotency_key: "lp-u5", loan_id: LOAN, project_id: bad }, ["write"], rpc);
    assertEquals(out.isError, true);
    if (!out.structuredContent.ok) assertEquals(out.structuredContent.error.code, "validation");
  }
  const denied = await callTool("update_loan", { idempotency_key: "lp-u6", loan_id: LOAN, project_id: PROJECT }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  assertEquals(calls.length, 3);
});

Deno.test("a database refusal of a project is a tool error with its message", async () => {
  const { rpc } = rpcOf((name) => {
    if (name === "mcp_update_loan") {
      return { status: 200, json: { ok: false, error: { code: "refused", message: "project not found" } } };
    }
    return { status: 500, json: null };
  });
  const out = await callTool("update_loan", { idempotency_key: "lp-r1", loan_id: LOAN, project_id: PROJECT_B }, ["write"], rpc);
  assertEquals(out.isError, true);
  if (!out.structuredContent.ok) {
    assertEquals(out.structuredContent.error.code, "refused");
    assertEquals(out.structuredContent.error.message, "project not found");
  }
});

Deno.test("the loan and project tool descriptions and schemas name project_id", () => {
  const write = toolsFor(["write"]);
  const read = toolsFor(["read"]);
  const spec = (list: ReturnType<typeof toolsFor>, name: string) => list.find((tool) => tool.name === name);
  const add = spec(write, "add_loan");
  const update = spec(write, "update_loan");
  const attach = spec(write, "attach_loan_payment");
  assertEquals(add?.inputSchema.properties.project_id, { type: "string" });
  assertEquals(update?.inputSchema.properties.project_id, { type: ["string", "null"] });
  assertEquals(add?.description.includes("project_id"), true);
  assertEquals(update?.description.includes("null clears it"), true);
  assertEquals(update?.description.includes("Undo restores the previous project"), true);
  assertEquals(attach?.description.includes("project_inherited"), true);
  assertEquals(attach?.description.includes("principal is kept out of the P&L"), true);
  assertEquals(spec(read, "list_loans")?.description.includes("project_name"), true);
  assertEquals(spec(read, "get_project")?.description.includes("loans lists the loans filed under this project"), true);
});

Deno.test("list_loans passes the project through, and attach reports whether the line inherited it", async () => {
  const loanRow = {
    id: LOAN,
    name: "Example Bank",
    currency: "USD",
    principal_minor: 12000000,
    annual_rate_ppm: 68750,
    term_months: 360,
    start_date: "2026-01-01",
    payment_minor: 100000,
    escrow_minor: 10000,
    balance_minor: 12000000,
    project_id: PROJECT,
    project_name: "Site One",
  };
  const attachData = (inherited: boolean) => ({
    ok: true,
    data: {
      loan_id: LOAN,
      transaction_id: LOAN_TXN,
      project_inherited: inherited,
      project_id: inherited ? PROJECT : null,
      project_inherited_reason: inherited ? null : "line already has a project",
      undo_kind: "loan_split",
    },
  });
  for (const inherited of [true, false]) {
    const { rpc } = rpcOf((name) => {
      if (name === "get_transaction") {
        return { status: 200, json: { id: LOAN_TXN, doc_date: "2026-01-01", amount_original: 100000, currency: "USD" } };
      }
      if (name === "mcp_list_loans") return { status: 200, json: [loanRow] };
      if (name === "get_loan_split") return { status: 200, json: null };
      if (name === "mcp_attach_loan_payment") return { status: 200, json: attachData(inherited) };
      return { status: 500, json: null };
    });
    const listed = await callTool("list_loans", {}, ["read"], rpc);
    if (listed.structuredContent.ok) {
      const loans = (listed.structuredContent.data as { loans: typeof loanRow[] }).loans;
      assertEquals(loans[0]?.project_id, PROJECT);
      assertEquals(loans[0]?.project_name, "Site One");
    } else {
      throw new Error("list_loans failed");
    }
    const attached = await callTool("attach_loan_payment", { idempotency_key: `lp-a-${inherited}`, transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], rpc);
    assertEquals(attached.isError, false);
    if (attached.structuredContent.ok) {
      const data = attached.structuredContent.data as { project_inherited: boolean; project_inherited_reason: string | null };
      assertEquals(data.project_inherited, inherited);
      assertEquals(data.project_inherited_reason, inherited ? null : "line already has a project");
    }
  }
});

Deno.test("get_project passes the loans of the project through next to the P&L", async () => {
  const loans = [{ id: LOAN, name: "Example Bank", currency: "USD", balance_minor: 12000000 }];
  const { calls, rpc } = rpcOf((name) => name === "get_project"
    ? { status: 200, json: { ...PROJECT_FIXTURE, loans } }
    : { status: 500, json: null });
  const result = await callTool("get_project", { id: PROJECT }, ["read"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls.length, 1);
  if (result.structuredContent.ok) {
    const data = result.structuredContent.data as typeof PROJECT_FIXTURE & { loans: typeof loans };
    assertEquals(data.loans, loans);
    assertEquals(data.by_currency, PROJECT_FIXTURE.by_currency);
  }
});

Deno.test("list_review and pending search_expenses pass line_status and source through (FLOW-305)", async () => {
  const row = {
    id: "rev-305",
    transaction_id: "11111111-1111-4000-8000-000000000305",
    description: "חשמל השרון",
    direction: "expense",
    reason: "missing_project",
    supplier_name: null,
    doc_date: "2026-10-05",
    line_status: "pending",
    source: "mercury",
  };
  // FLOW-304: list_review also reads the lines' bank details; none here.
  const { rpc } = rpcOf((name) =>
    name === "list_review" ? { status: 200, json: [row] } : name === "get_line_meta" ? { status: 200, json: [] } : { status: 500, json: null }
  );
  const listed = await callTool("list_review", {}, ["read"], rpc);
  const pending = await callTool("search_expenses", { scope: "pending" }, ["read"], rpc);
  assertEquals(listed.structuredContent.ok, true);
  assertEquals(pending.structuredContent.ok, true);
  if (listed.structuredContent.ok) {
    const first = (listed.structuredContent.data as { reviews: Record<string, unknown>[] }).reviews[0];
    assertEquals(first?.line_status, "pending");
    assertEquals(first?.source, "mercury");
  }
  if (pending.structuredContent.ok) {
    const first = (pending.structuredContent.data as { expenses: Record<string, unknown>[] }).expenses[0];
    assertEquals(first?.line_status, "pending");
    assertEquals(first?.source, "mercury");
  }
});

Deno.test("FLOW-304: get_expense, list_review and search_expenses carry the line's bank details", async () => {
  const id = "11111111-1111-4000-8000-000000000001";
  const other = "11111111-1111-4000-8000-000000000002";
  const card = {
    method: "card",
    card_last4: "4242",
    memo: null,
    account: "Example Checking",
    counterparty: "Example Office Suite",
    bank_description: "Example Office Suite",
  };
  const { calls, rpc } = rpcOf((name, body) => {
    if (name === "get_transaction") return { status: 200, json: { id, description: "Example Office Suite" } };
    if (name === "get_line_split") return { status: 200, json: null };
    if (name === "get_loan_split") return { status: 200, json: null };
    if (name === "list_review") {
      return { status: 200, json: [
        { id: "r1", transaction_id: id, description: "א", direction: "expense", doc_date: "2026-09-01" },
        { id: "r2", transaction_id: other, description: "ב", direction: "expense", doc_date: "2026-09-02" },
      ] };
    }
    if (name === "search_transactions") return { status: 200, json: { total: 1, expenses: [{ id }] } };
    if (name === "get_line_meta") {
      assertEquals(Array.isArray(body.p_ids), true);
      return { status: 200, json: [{ transaction_id: id, ...card }] };
    }
    return { status: 500, json: null };
  });
  const expense = await callTool("get_expense", { transaction_id: id }, ["read"], rpc);
  assertEquals(expense.structuredContent.ok, true);
  if (expense.structuredContent.ok) assertEquals((expense.structuredContent.data as { meta: unknown }).meta, card);
  const review = await callTool("list_review", {}, ["read"], rpc);
  if (!review.structuredContent.ok) throw new Error("list_review failed");
  const reviews = (review.structuredContent.data as { reviews: Array<{ transaction_id: string; meta: Record<string, unknown> }> }).reviews;
  assertEquals(reviews.find((row) => row.transaction_id === id)?.meta, card);
  // A line with no bank details still carries meta, with every field null.
  assertEquals(reviews.find((row) => row.transaction_id === other)?.meta, NO_META);
  const filed = await callTool("search_expenses", { scope: "filed" }, ["read"], rpc);
  if (!filed.structuredContent.ok) throw new Error("search_expenses failed");
  assertEquals((filed.structuredContent.data as { expenses: Array<{ meta: unknown }> }).expenses[0]?.meta, card);
  const metaCalls = calls.filter((call) => call.name === "get_line_meta");
  assertEquals(metaCalls.length, 3);
  assertEquals(metaCalls[1]?.body.p_ids, [id, other]);
});

Deno.test("FLOW-304: a refused bank-details read fails the read instead of dropping meta", async () => {
  const id = "11111111-1111-4000-8000-000000000001";
  const { rpc } = rpcOf((name) => {
    if (name === "get_transaction") return { status: 200, json: { id } };
    if (name === "list_review") return { status: 200, json: [{ id: "r1", transaction_id: id }] };
    return { status: 500, json: null };
  });
  for (const result of [
    await callTool("get_expense", { transaction_id: id }, ["read"], rpc),
    await callTool("list_review", {}, ["read"], rpc),
  ]) {
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "refused");
  }
});

Deno.test("update_loan sends status and closed_on, and validates them first", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "mcp_update_loan") {
      return { status: 200, json: { ok: true, data: { id: LOAN, status: "paid_off", closed_on: "2026-02-01", balance_left: 500, undo_kind: "loan_update" } } };
    }
    return { status: 500, json: null };
  });
  const closed = await callTool("update_loan", { idempotency_key: "ls-1", loan_id: LOAN, status: "paid_off", closed_on: "2026-02-01" }, ["write"], rpc);
  assertEquals(closed.isError, false);
  assertEquals(calls[0]?.body.p_patch, { status: "paid_off", closed_on: "2026-02-01" });
  const reopened = await callTool("update_loan", { idempotency_key: "ls-2", loan_id: LOAN, status: "open" }, ["write"], rpc);
  assertEquals(reopened.isError, false);
  assertEquals(calls[1]?.body.p_patch, { status: "open" });
  const cleared = await callTool("update_loan", { idempotency_key: "ls-3", loan_id: LOAN, closed_on: null }, ["write"], rpc);
  assertEquals(cleared.isError, false);
  assertEquals(calls[2]?.body.p_patch, { closed_on: null });
  for (const bad of [{ status: "done" }, { status: null }, { closed_on: "2026-2-1" }, { closed_on: 20260201 }]) {
    const out = await callTool("update_loan", { idempotency_key: "ls-bad", loan_id: LOAN, ...bad }, ["write"], rpc);
    assertEquals(out.isError, true);
    if (!out.structuredContent.ok) assertEquals(out.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 3);
});

Deno.test("list_loans hides closed loans only when asked, and attach refuses a line after closed_on", async () => {
  const base = {
    name: "Example Bank",
    currency: "USD",
    principal_minor: 10000000,
    annual_rate_ppm: 60000,
    term_months: 360,
    start_date: "2026-01-01",
    payment_minor: 100000,
    escrow_minor: 10000,
    balance_minor: 9000000,
  };
  const open = { ...base, id: LOAN, status: "open", closed_on: null };
  const paid = { ...base, id: "dddddddd-dddd-4000-8000-0000000000d2", status: "paid_off", closed_on: "2026-02-01" };
  let docDate = "2026-03-01";
  const { calls, rpc } = rpcOf((name) => {
    if (name === "mcp_list_loans") return { status: 200, json: [open, paid] };
    if (name === "get_loan_split") return { status: 200, json: null };
    if (name === "get_transaction") {
      return { status: 200, json: { id: LOAN_TXN, doc_date: docDate, amount_original: 100000, currency: "USD" } };
    }
    if (name === "mcp_attach_loan_payment") {
      return { status: 200, json: { ok: true, data: { loan_id: paid.id, transaction_id: LOAN_TXN, undo_kind: "loan_split" } } };
    }
    return { status: 500, json: null };
  });
  const all = await callTool("list_loans", {}, ["read"], rpc);
  if (all.structuredContent.ok) assertEquals((all.structuredContent.data as { loans: unknown[] }).loans.length, 2);
  const openOnly = await callTool("list_loans", { include_closed: false }, ["read"], rpc);
  if (openOnly.structuredContent.ok) {
    assertEquals((openOnly.structuredContent.data as { loans: Array<{ id: string }> }).loans.map((loan) => loan.id), [LOAN]);
  }
  const bad = await callTool("list_loans", { include_closed: "no" }, ["read"], rpc);
  assertEquals(bad.isError, true);

  const late = await callTool("attach_loan_payment", { idempotency_key: "ls-a1", transaction_id: LOAN_TXN, loan_id: paid.id }, ["write"], rpc);
  assertEquals(late.structuredContent, { ok: false, error: { code: "refused", message: "loan closed" } });
  assertEquals(calls.some((call) => call.name === "mcp_attach_loan_payment"), false);

  docDate = "2026-02-01";
  const onTheDay = await callTool("attach_loan_payment", { idempotency_key: "ls-a2", transaction_id: LOAN_TXN, loan_id: paid.id }, ["write"], rpc);
  assertEquals(onTheDay.isError, false);
});

Deno.test("get_jev_status passes the status through and refuses a failed read", async () => {
  const status = {
    enabled: true,
    mode: "shadow",
    threshold: 0.9,
    daily_call_cap: 200,
    calls_today: 12,
    last_run_at: "2026-10-08T05:00:00Z",
    lines_without_suggestion: 3,
  };
  const calls: string[] = [];
  const read = await callTool("get_jev_status", {}, ["read"], (name) => {
    calls.push(name);
    return Promise.resolve({ status: 200, json: status });
  });
  assertEquals(read.structuredContent, { ok: true, data: status });
  assertEquals(calls, ["mcp_jev_status"]);
  const failed = await callTool("get_jev_status", {}, ["read"], () => Promise.resolve({ status: 403, json: null }));
  assertEquals(failed.isError, true);
  const extra = await callTool("get_jev_status", { company_id: "x" }, ["read"], () => Promise.resolve({ status: 200, json: status }));
  assertEquals(extra.isError, true);
  const writeOnly = await callTool("get_jev_status", {}, ["write"], () => Promise.resolve({ status: 200, json: status }));
  assertEquals(writeOnly.isError, true);
});

Deno.test("get_jev_accuracy checks its dates and passes the report through", async () => {
  const report = { lines: 5, all_matched: 3, bands: [] };
  const calls: Array<[string, unknown]> = [];
  const rpc = (name: string, body: unknown) => {
    calls.push([name, body]);
    return Promise.resolve({ status: 200, json: report });
  };
  const all = await callTool("get_jev_accuracy", {}, ["read"], rpc);
  assertEquals(all.structuredContent, { ok: true, data: report });
  const month = await callTool("get_jev_accuracy", { from: "2026-10-01", to: "2026-10-31" }, ["read"], rpc);
  assertEquals(month.isError, false);
  assertEquals(calls, [
    ["mcp_jev_accuracy", { p_from: null, p_to: null }],
    ["mcp_jev_accuracy", { p_from: "2026-10-01", p_to: "2026-10-31" }],
  ]);
  assertEquals((await callTool("get_jev_accuracy", { from: "2026-10-31", to: "2026-10-01" }, ["read"], rpc)).isError, true);
  assertEquals((await callTool("get_jev_accuracy", { from: "yesterday" }, ["read"], rpc)).isError, true);
  assertEquals((await callTool("get_jev_accuracy", { basis: "cash" }, ["read"], rpc)).isError, true);
  assertEquals(calls.length, 2);
  const refused = await callTool("get_jev_accuracy", {}, ["read"], () => Promise.resolve({ status: 400, json: null }));
  assertEquals(refused.isError, true);
  const writeOnly = await callTool("get_jev_accuracy", {}, ["write"], rpc);
  assertEquals(writeOnly.isError, true);
  assertEquals(calls.length, 2);
});

Deno.test("update_loan sends the part categories as uuids or null, and validates them first", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "mcp_update_loan") return { status: 200, json: { ok: true, data: { id: LOAN, undo_kind: "loan_update" } } };
    return { status: 500, json: null };
  });
  const set = await callTool("update_loan", { idempotency_key: "lc-1", loan_id: LOAN, interest_category_id: CATEGORY, principal_category_id: null }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls[0]?.body.p_patch, { interest_category_id: CATEGORY, principal_category_id: null });
  for (const bad of ["not-a-uuid", 5, true]) {
    const out = await callTool("update_loan", { idempotency_key: "lc-2", loan_id: LOAN, escrow_category_id: bad }, ["write"], rpc);
    assertEquals(out.isError, true);
    if (!out.structuredContent.ok) assertEquals(out.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 1);
});

Deno.test("get_anomalies and get_missing_bills take no arguments and pass the SQL result through", async () => {
  const calls: Array<[string, unknown]> = [];
  const rpc = (name: string, body: unknown) => {
    calls.push([name, body]);
    if (name === "mcp_review_anomalies") {
      return Promise.resolve({ status: 200, json: { anomalies: [{ transaction_id: "t", kind: "duplicate" }] } });
    }
    return Promise.resolve({ status: 200, json: [{ supplier_name: "שכירות", typical_day: 3 }] });
  };
  const anomalies = await callTool("get_anomalies", {}, ["read"], rpc);
  assertEquals(anomalies.structuredContent, { ok: true, data: { anomalies: [{ transaction_id: "t", kind: "duplicate" }] } });
  const missing = await callTool("get_missing_bills", {}, ["read"], rpc);
  assertEquals(missing.structuredContent, { ok: true, data: { missing: [{ supplier_name: "שכירות", typical_day: 3 }] } });
  assertEquals(calls, [["mcp_review_anomalies", {}], ["missing_bills", {}]]);
  assertEquals((await callTool("get_missing_bills", { today: "2026-01-01" }, ["read"], rpc)).isError, true);
  assertEquals((await callTool("get_anomalies", {}, ["read"], () => Promise.resolve({ status: 403, json: null }))).isError, true);
  assertEquals((await callTool("get_missing_bills", {}, ["read"], () => Promise.resolve({ status: 200, json: {} }))).isError, true);
  assertEquals((await callTool("get_anomalies", {}, ["write"], rpc)).isError, true);
  assertEquals(calls.length, 2);
});

Deno.test("get_expected_months checks months and project_id", async () => {
  const calls: Array<[string, unknown]> = [];
  const report = { today: "2026-04-20", months: [], recurring: [] };
  const rpc = (name: string, body: unknown) => {
    calls.push([name, body]);
    return Promise.resolve({ status: 200, json: report });
  };
  const project = "11111111-1111-4111-8111-111111111111";
  assertEquals((await callTool("get_expected_months", {}, ["read"], rpc)).structuredContent, { ok: true, data: report });
  assertEquals((await callTool("get_expected_months", { months: 12, project_id: project }, ["read"], rpc)).isError, false);
  assertEquals(calls, [
    ["expected_months", { p_months: 3, p_project_id: null }],
    ["expected_months", { p_months: 12, p_project_id: project }],
  ]);
  for (const bad of [{ months: 0 }, { months: 13 }, { months: 2.5 }, { months: "3" }, { project_id: "x" }, { from: "2026-01-01" }]) {
    assertEquals((await callTool("get_expected_months", bad, ["read"], rpc)).isError, true);
  }
  assertEquals(calls.length, 2);
  assertEquals((await callTool("get_expected_months", {}, ["read"], () => Promise.resolve({ status: 400, json: null }))).isError, true);
  assertEquals((await callTool("get_expected_months", {}, ["write"], rpc)).isError, true);
});

// FLOW-106 part 3 (decision 0130): installments, a fees part, and exact parts.
const FEES_LOAN = {
  id: LOAN,
  name: "Example Bank",
  currency: "USD",
  principal_minor: 12000000,
  annual_rate_ppm: 68750,
  term_months: 360,
  start_date: "2026-01-01",
  payment_minor: 100000,
  escrow_minor: 10000,
  balance_minor: 12000000,
  // The loan names a fees category; without one (or one on the call) fees are refused.
  fees_category_id: CATEGORY,
};
const FEES_SCHEDULE = buildLoanSchedule({
  principalMinor: BigInt(FEES_LOAN.principal_minor),
  annualRatePpm: FEES_LOAN.annual_rate_ppm,
  termMonths: FEES_LOAN.term_months,
  startDate: FEES_LOAN.start_date,
  paymentMinor: BigInt(FEES_LOAN.payment_minor),
  escrowMinor: BigInt(FEES_LOAN.escrow_minor),
});

/** A payment already on the loan, as mcp_loan_payments lists it. */
function paidRow(transactionId: string, row: { interestMinor: bigint; principalMinor: bigint; escrowMinor?: bigint }, extra: Record<string, unknown> = {}) {
  return {
    transaction_id: transactionId,
    doc_date: "2026-01-01",
    line_status: "posted",
    needs_review: false,
    interest_minor: Number(row.interestMinor),
    escrow_minor: Number(row.escrowMinor ?? 0n),
    principal_minor: Number(row.principalMinor),
    fees_minor: 0,
    ...extra,
  };
}

function feesRpc(
  loan: Record<string, unknown>,
  lineMinor: number,
  docDate = "2026-01-01",
  split: unknown = null,
  payments: unknown[] = [],
) {
  return rpcOf((name) => {
    if (name === "get_loan_split") return { status: 200, json: split };
    if (name === "mcp_loan_payments") return { status: 200, json: payments };
    if (name === "get_transaction") {
      return { status: 200, json: { id: LOAN_TXN, doc_date: docDate, amount_original: lineMinor, currency: "USD" } };
    }
    if (name === "mcp_list_loans") return { status: 200, json: [loan] };
    if (name === "mcp_attach_loan_payment") {
      return { status: 200, json: { ok: true, data: { loan_id: LOAN, transaction_id: LOAN_TXN, undo_kind: "loan_split" } } };
    }
    return { status: 500, json: null };
  });
}

function attachedParts(calls: Rpc[]) {
  return calls.find((call) => call.name === "mcp_attach_loan_payment")?.body.p_parts;
}

Deno.test("attach_loan_payment installments cover several rows from the first unpaid one", async () => {
  const rows = FEES_SCHEDULE.rows;
  // Two rows already paid: the balance is the principal less their principal.
  const paid = (rows[0]?.principalMinor ?? 0n) + (rows[1]?.principalMinor ?? 0n);
  const loan = { ...FEES_LOAN, balance_minor: Number(BigInt(FEES_LOAN.principal_minor) - paid) };
  const covered = rows.slice(2, 5);
  const sum = (key: "interestMinor" | "escrowMinor" | "principalMinor") =>
    covered.reduce((total, row) => total + row[key], 0n);
  const lineMinor = 300000;
  const expected = allocateLoanSplit({
    lineMinor: BigInt(lineMinor),
    interestMinor: sum("interestMinor"),
    escrowMinor: sum("escrowMinor"),
    principalMinor: sum("principalMinor"),
  });
  // The line's date is ignored: the rows start at the first one not yet paid, found from the
  // interest and principal of the payments already attached (decision 0132).
  const payments = [paidRow("ffffffff-ffff-4000-8000-0000000000f1", rows[0] ?? { interestMinor: 0n, principalMinor: 0n }), paidRow("ffffffff-ffff-4000-8000-0000000000f2", rows[1] ?? { interestMinor: 0n, principalMinor: 0n })];
  const { calls, rpc } = feesRpc(loan, lineMinor, "2027-06-01", null, payments);
  const out = await callTool("attach_loan_payment", {
    idempotency_key: "inst-1",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    installments: 3,
  }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(attachedParts(calls), expected.map((part) => ({
    part: part.part,
    amount_minor: Number(part.amountMinor),
    scheduled_minor: Number(part.scheduledMinor),
  })));
  assertEquals(expected[1]?.scheduledMinor, 30000n);
});

Deno.test("attach_loan_payment refuses installments that run past the schedule", async () => {
  const short = {
    ...FEES_LOAN,
    principal_minor: 100000,
    annual_rate_ppm: 0,
    term_months: 3,
    payment_minor: 30100,
    escrow_minor: 100,
    // The first row is paid (300.00 of principal), so two rows are left.
    balance_minor: 70000,
  };
  const { calls, rpc } = feesRpc(short, 60200, "2026-01-01", null, [paidRow("ffffffff-ffff-4000-8000-0000000000f1", { interestMinor: 0n, principalMinor: 30000n })]);
  const over = await callTool("attach_loan_payment", {
    idempotency_key: "inst-over",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    installments: 3,
  }, ["write"], rpc);
  assertEquals(over.structuredContent, { ok: false, error: { code: "refused", message: "not enough schedule rows" } });
  assertEquals(calls.some((call) => call.name === "mcp_attach_loan_payment"), false);
  const fits = await callTool("attach_loan_payment", {
    idempotency_key: "inst-fits",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    installments: 2,
  }, ["write"], rpc);
  assertEquals(fits.isError, false);
  assertEquals(attachedParts(calls), [
    { part: "interest", amount_minor: 0, scheduled_minor: 0 },
    { part: "escrow", amount_minor: 200, scheduled_minor: 200 },
    { part: "principal", amount_minor: 60000, scheduled_minor: 70000 },
  ]);
});

Deno.test("attach_loan_payment takes fees off the line first and lists the fees part", async () => {
  const row = scheduleRowForDate(FEES_SCHEDULE.rows, "2026-01-01");
  if (row == null) throw new Error("missing schedule row");
  const expected = allocateLoanSplit({
    lineMinor: 100000n,
    interestMinor: row.interestMinor,
    escrowMinor: row.escrowMinor,
    principalMinor: row.principalMinor,
  }).map((part) => ({
    part: part.part,
    amount_minor: Number(part.amountMinor),
    scheduled_minor: Number(part.scheduledMinor),
  }));
  const { calls, rpc } = feesRpc(FEES_LOAN, 125000);
  const out = await callTool("attach_loan_payment", {
    idempotency_key: "fees-1",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    fees: "250.00",
  }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(attachedParts(calls), [...expected, { part: "fees", amount_minor: 25000, scheduled_minor: 25000 }]);
  if (!out.structuredContent.ok) throw new Error("attach failed");
  const parts = (out.structuredContent.data as { parts: Array<Record<string, unknown>> }).parts;
  assertEquals(parts.length, 4);
  assertEquals(parts[3], { part: "fees", amount: "250", scheduled: "250", amount_minor: 25000, scheduled_minor: 25000 });

  // Fees and installments go together: the rest of the line covers the rows.
  const both = feesRpc(FEES_LOAN, 225000);
  const withRows = await callTool("attach_loan_payment", {
    idempotency_key: "fees-2",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    installments: 2,
    fees: 250,
  }, ["write"], both.rpc);
  assertEquals(withRows.isError, false);
  const sent = attachedParts(both.calls) as Array<{ part: string; amount_minor: number }>;
  assertEquals(sent.map((part) => part.part), ["interest", "escrow", "principal", "fees"]);
  assertEquals(sent.reduce((total, part) => total + part.amount_minor, 0), 225000);
});

Deno.test("attach_loan_payment refuses fees larger than the line and fees that are not above zero", async () => {
  const { calls, rpc } = feesRpc(FEES_LOAN, 10000);
  const over = await callTool("attach_loan_payment", {
    idempotency_key: "fees-over",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    fees: "100.01",
  }, ["write"], rpc);
  assertEquals(over.structuredContent, { ok: false, error: { code: "refused", message: "fees exceed the line" } });
  for (const fees of [0, "0.00", "-5", "abc", true]) {
    const out = await callTool("attach_loan_payment", {
      idempotency_key: "fees-bad",
      transaction_id: LOAN_TXN,
      loan_id: LOAN,
      fees,
    }, ["write"], rpc);
    assertEquals(out.structuredContent, { ok: false, error: { code: "validation", message: "validation" } });
  }
  assertEquals(calls.some((call) => call.name === "mcp_attach_loan_payment"), false);
});

Deno.test("attach_loan_payment uses exact parts as given and keeps the schedule for comparison", async () => {
  const row = scheduleRowForDate(FEES_SCHEDULE.rows, "2026-01-01");
  if (row == null) throw new Error("missing schedule row");
  const { calls, rpc } = feesRpc(FEES_LOAN, 100000);
  const out = await callTool("attach_loan_payment", {
    idempotency_key: "exact-1",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    parts: { interest: "0", escrow: "100.00", principal: 300, fees: "600.00" },
  }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(attachedParts(calls), [
    { part: "interest", amount_minor: 0, scheduled_minor: Number(row.interestMinor) },
    { part: "escrow", amount_minor: 10000, scheduled_minor: Number(row.escrowMinor) },
    { part: "principal", amount_minor: 30000, scheduled_minor: Number(row.principalMinor) },
    { part: "fees", amount_minor: 60000, scheduled_minor: 60000 },
  ]);

  const three = feesRpc(FEES_LOAN, 100000);
  const noFees = await callTool("attach_loan_payment", {
    idempotency_key: "exact-2",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    parts: { interest: "1,000.00", escrow: 0, principal: 0 },
  }, ["write"], three.rpc);
  assertEquals(noFees.isError, false);
  assertEquals((attachedParts(three.calls) as unknown[]).length, 3);
});

Deno.test("attach_loan_payment refuses exact parts that do not add up or pass the balance", async () => {
  const { calls, rpc } = feesRpc({ ...FEES_LOAN, balance_minor: 20000 }, 100000);
  const off = await callTool("attach_loan_payment", {
    idempotency_key: "exact-off",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    parts: { interest: "500.00", escrow: "100.00", principal: "399.99" },
  }, ["write"], rpc);
  assertEquals(off.structuredContent, { ok: false, error: { code: "refused", message: "parts don't add up" } });
  const over = await callTool("attach_loan_payment", {
    idempotency_key: "exact-over",
    transaction_id: LOAN_TXN,
    loan_id: LOAN,
    parts: { interest: "500.00", escrow: "100.00", principal: "400.00" },
  }, ["write"], rpc);
  assertEquals(over.structuredContent, { ok: false, error: { code: "refused", message: "loan balance exceeded" } });
  assertEquals(calls.some((call) => call.name === "mcp_attach_loan_payment"), false);
});

Deno.test("attach_loan_payment validates installments, fees and parts before reading", async () => {
  const { calls, rpc } = feesRpc(FEES_LOAN, 100000);
  const base = { idempotency_key: "bad", transaction_id: LOAN_TXN, loan_id: LOAN };
  const exact = { interest: "500.00", escrow: "100.00", principal: "400.00" };
  const bad: Array<Record<string, unknown>> = [
    { installments: 0 },
    { installments: 13 },
    { installments: 1.5 },
    { installments: "2" },
    { parts: exact, installments: 2 },
    { parts: exact, fees: "10.00" },
    { parts: { ...exact, fees: "0" } },
    { parts: { ...exact, fees: -1 } },
    { parts: { interest: "500.00", escrow: "100.00" } },
    { parts: { ...exact, extra: "1" } },
    { parts: { ...exact, principal: "-1" } },
    { parts: { ...exact, escrow: "1.234" } },
    { parts: { ...exact, fees: 0.125 } },
    { fees: "10.005" },
    { fees_category_id: INCOME_CATEGORY },
    { parts: exact, fees_category_id: INCOME_CATEGORY },
    { fees: "10.00", fees_category_id: "not-a-uuid" },
    { parts: [] },
  ];
  for (const extra of bad) {
    const out = await callTool("attach_loan_payment", { ...base, ...extra }, ["write"], rpc);
    assertEquals(out.structuredContent, { ok: false, error: { code: "validation", message: "validation" } }, JSON.stringify(extra));
  }
  assertEquals(calls.length, 0);
});

Deno.test("update_loan sends fees_category_id, and the loan tool descriptions name the new inputs", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "mcp_update_loan") return { status: 200, json: { ok: true, data: { id: LOAN, undo_kind: "loan_update" } } };
    return { status: 500, json: null };
  });
  const set = await callTool("update_loan", { idempotency_key: "fc-1", loan_id: LOAN, fees_category_id: CATEGORY }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls[0]?.body.p_patch, { fees_category_id: CATEGORY });
  const cleared = await callTool("update_loan", { idempotency_key: "fc-2", loan_id: LOAN, fees_category_id: null }, ["write"], rpc);
  assertEquals(cleared.isError, false);
  assertEquals(calls[1]?.body.p_patch, { fees_category_id: null });
  const bad = await callTool("update_loan", { idempotency_key: "fc-3", loan_id: LOAN, fees_category_id: "nope" }, ["write"], rpc);
  assertEquals(bad.structuredContent, { ok: false, error: { code: "validation", message: "validation" } });
  assertEquals(calls.length, 2);

  const write = toolsFor(["write"]);
  const read = toolsFor(["read"]);
  const spec = (list: ReturnType<typeof toolsFor>, name: string) => list.find((tool) => tool.name === name);
  const attach = spec(write, "attach_loan_payment");
  assertEquals(Object.keys(attach?.inputSchema.properties ?? {}), [
    "idempotency_key", "transaction_id", "loan_id", "installments", "fees", "parts", "fees_category_id",
  ]);
  for (const words of ["installments (1 to 12)", "not enough schedule rows", "parts don't add up", "fees exceed the line", "fees category required"]) {
    assertEquals(attach?.description.includes(words), true, words);
  }
  assertEquals(spec(write, "update_loan")?.inputSchema.properties.fees_category_id, { type: ["string", "null"] });
  assertEquals(spec(write, "update_loan")?.description.includes("fees_category_id"), true);
  assertEquals(spec(read, "list_loans")?.description.includes("fees_category_name"), true);
});

Deno.test("an installments attach replayed with the same key rebuilds the same parts", async () => {
  const rows = FEES_SCHEDULE.rows;
  const paid = rows[0]?.principalMinor ?? 0n;
  const earlier = paidRow("ffffffff-ffff-4000-8000-0000000000f1", rows[0] ?? { interestMinor: 0n, principalMinor: 0n });
  const before = { ...FEES_LOAN, balance_minor: Number(BigInt(FEES_LOAN.principal_minor) - paid) };
  const args = { idempotency_key: "inst-replay", transaction_id: LOAN_TXN, loan_id: LOAN, installments: 2, fees: "10.00" };
  const first = feesRpc(before, 201000, "2026-01-01", null, [earlier]);
  assertEquals((await callTool("attach_loan_payment", args, ["write"], first.rpc)).isError, false);
  const sent = attachedParts(first.calls) as Array<{ part: string; amount_minor: number }>;
  const amount = (part: string) => BigInt(sent.find((row) => row.part === part)?.amount_minor ?? 0);
  const principal = Number(amount("principal"));
  // The first attach is now on the loan. The replay leaves the line's own payment out of what
  // was paid, and adds its principal back to the balance, so it sends the same parts.
  const after = { ...before, balance_minor: before.balance_minor - principal };
  const split = { loan_id: LOAN, needs_review: false, by_parts: true, parts: sent.map((part) => ({ ...part, in_pnl: part.part !== "principal" })) };
  const own = paidRow(LOAN_TXN, { interestMinor: amount("interest"), principalMinor: amount("principal") });
  const replay = feesRpc(after, 201000, "2026-01-01", split, [earlier, own]);
  assertEquals((await callTool("attach_loan_payment", args, ["write"], replay.rpc)).isError, false);
  assertEquals(attachedParts(replay.calls), sent);
  // Another line's payment does move the start row on.
  const other = feesRpc(after, 201000, "2026-01-01", null, [earlier, { ...own, transaction_id: "ffffffff-ffff-4000-8000-0000000000f3" }]);
  await callTool("attach_loan_payment", args, ["write"], other.rpc);
  assertEquals(JSON.stringify(attachedParts(other.calls)) === JSON.stringify(sent), false);
  // A payment waiting for review counts nowhere, so it does not.
  const flagged = feesRpc(before, 201000, "2026-01-01", null, [earlier, { ...own, transaction_id: "ffffffff-ffff-4000-8000-0000000000f3", needs_review: true }]);
  await callTool("attach_loan_payment", args, ["write"], flagged.rpc);
  assertEquals(attachedParts(flagged.calls), sent);
});

Deno.test("installments: an interest-only loan's rows are found by the interest paid, pending lines too", async () => {
  // 120,000.00 at 6%, 12 interest-only months of 600.00 then 12 amortizing.
  const io = {
    ...FEES_LOAN,
    principal_minor: 12_000_000,
    annual_rate_ppm: 60_000,
    term_months: 24,
    payment_minor: 1_032_797,
    escrow_minor: 0,
    balance_minor: 12_000_000,
    kind: "interest_only",
    interest_only_months: 12,
  };
  // Two interest-only months already attached (one still pending): no principal was paid.
  const payments = [
    paidRow("ffffffff-ffff-4000-8000-0000000000f1", { interestMinor: 60_000n, principalMinor: 0n }),
    paidRow("ffffffff-ffff-4000-8000-0000000000f2", { interestMinor: 60_000n, principalMinor: 0n }, { line_status: "pending" }),
  ];
  const { calls, rpc } = feesRpc(io, 120_000, "2026-03-01", null, payments);
  const out = await callTool("attach_loan_payment", { idempotency_key: "io-inst", transaction_id: LOAN_TXN, loan_id: LOAN, installments: 2 }, ["write"], rpc);
  assertEquals(out.isError, false);
  // Rows 3 and 4: interest only, so the scheduled principal is 0 and the line is all interest.
  assertEquals(attachedParts(calls), [
    { part: "interest", amount_minor: 120_000, scheduled_minor: 120_000 },
    { part: "escrow", amount_minor: 0, scheduled_minor: 0 },
    { part: "principal", amount_minor: 0, scheduled_minor: 0 },
  ]);
  assertEquals(calls.find((call) => call.name === "mcp_loan_payments")?.body, { p_loan_id: LOAN });
});

Deno.test("attach_loan_payment refuses when the line's loan split cannot be read", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_transaction") {
      return { status: 200, json: { id: LOAN_TXN, doc_date: "2026-01-01", amount_original: 100000, currency: "USD" } };
    }
    if (name === "mcp_list_loans") return { status: 200, json: [FEES_LOAN] };
    return { status: 500, json: null };
  });
  const out = await callTool("attach_loan_payment", { idempotency_key: "split-read", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], rpc);
  assertEquals(out.structuredContent, { ok: false, error: { code: "refused", message: "The read was refused." } });
  assertEquals(calls.some((call) => call.name === "mcp_attach_loan_payment"), false);
});

Deno.test("attach_loan_payment files fees under the call's category, else the loan's, else refuses", async () => {
  const exact = { interest: "500.00", escrow: "100.00", principal: "300.00", fees: "100.00" };
  const feesPart = (calls: Rpc[]) =>
    (attachedParts(calls) as Array<Record<string, unknown>>).find((part) => part.part === "fees");

  // The call's category wins over the loan's, and is sent with the fees part.
  const won = feesRpc(FEES_LOAN, 100000);
  const out = await callTool("attach_loan_payment", {
    idempotency_key: "fc-call", transaction_id: LOAN_TXN, loan_id: LOAN, parts: exact, fees_category_id: INCOME_CATEGORY,
  }, ["write"], won.rpc);
  assertEquals(out.isError, false);
  assertEquals(feesPart(won.calls), { part: "fees", amount_minor: 10000, scheduled_minor: 10000, category_id: INCOME_CATEGORY });
  if (out.structuredContent.ok) {
    const parts = (out.structuredContent.data as { parts: Array<Record<string, unknown>> }).parts;
    assertEquals(parts[3]?.category_id, INCOME_CATEGORY);
  }

  // Without one on the call, the database files the fees under the loan's category.
  const loanCat = feesRpc(FEES_LOAN, 100000);
  assertEquals((await callTool("attach_loan_payment", {
    idempotency_key: "fc-loan", transaction_id: LOAN_TXN, loan_id: LOAN, parts: exact,
  }, ["write"], loanCat.rpc)).isError, false);
  assertEquals(feesPart(loanCat.calls), { part: "fees", amount_minor: 10000, scheduled_minor: 10000 });

  // Neither: refused before the write, for exact parts and for top-level fees.
  const none = feesRpc({ ...FEES_LOAN, fees_category_id: null }, 100000);
  for (const extra of [{ parts: exact }, { fees: "100.00" }]) {
    const refused = await callTool("attach_loan_payment", {
      idempotency_key: "fc-none", transaction_id: LOAN_TXN, loan_id: LOAN, ...extra,
    }, ["write"], none.rpc);
    assertEquals(refused.structuredContent, { ok: false, error: { code: "refused", message: "fees category required" } });
  }
  assertEquals(none.calls.some((call) => call.name === "mcp_attach_loan_payment"), false);

  // A payment without fees needs no fees category.
  const plain = feesRpc({ ...FEES_LOAN, fees_category_id: null }, 100000);
  assertEquals((await callTool("attach_loan_payment", {
    idempotency_key: "fc-plain", transaction_id: LOAN_TXN, loan_id: LOAN,
  }, ["write"], plain.rpc)).isError, false);

  // The database's refusals for a category that does not fit or is not found pass through.
  for (const message of ["category does not fit the loan part", "category not found"]) {
    const { rpc } = rpcOf((name) => {
      if (name === "get_transaction") {
        return { status: 200, json: { id: LOAN_TXN, doc_date: "2026-01-01", amount_original: 100000, currency: "USD" } };
      }
      if (name === "mcp_list_loans") return { status: 200, json: [FEES_LOAN] };
      if (name === "get_loan_split") return { status: 200, json: null };
      if (name === "mcp_attach_loan_payment") return { status: 200, json: { ok: false, error: { code: "refused", message } } };
      return { status: 500, json: null };
    });
    const refused = await callTool("attach_loan_payment", {
      idempotency_key: "fc-db", transaction_id: LOAN_TXN, loan_id: LOAN, parts: exact, fees_category_id: INCOME_CATEGORY,
    }, ["write"], rpc);
    assertEquals(refused.structuredContent, { ok: false, error: { code: "refused", message } });
  }
});

// FLOW-106 part 4: loan kinds and a variable rate (decision 0132).

function addLoanRpc() {
  return rpcOf((name) => {
    if (name === "mcp_company_loan_currency") return { status: 200, json: "USD" };
    if (name === "mcp_add_loan") return { status: 200, json: { ok: true, data: { id: LOAN, undo_kind: "loan" } } };
    return { status: 500, json: null };
  });
}

Deno.test("add_loan takes the kind fields and computes each kind's payment", async () => {
  const io = addLoanRpc();
  const out = await callTool("add_loan", {
    idempotency_key: "k-io", name: "Example Note", principal: "120000", annual_rate_percent: 6,
    term_months: 24, start_date: "2026-01-01", kind: "interest_only", interest_only_months: 12,
  }, ["write"], io.rpc);
  assertEquals(out.isError, false);
  const ioPayment = regularPaymentMinor({
    principalMinor: 12_000_000n, annualRatePpm: 60_000, termMonths: 24, escrowMinor: 0n, kind: "interest_only", interestOnlyMonths: 12,
  });
  const ioBody = io.calls.find((call) => call.name === "mcp_add_loan")?.body;
  assertEquals(ioBody?.p_payment_minor, Number(ioPayment));
  assertEquals([ioBody?.p_kind, ioBody?.p_interest_only_months, ioBody?.p_amortization_months], ["interest_only", 12, null]);
  if (out.structuredContent.ok) {
    const preview = (out.structuredContent.data as { schedule_preview: Array<{ principal_minor: number; interest_minor: number }> }).schedule_preview;
    assertEquals(preview[0], { ...preview[0], principal_minor: 0, interest_minor: 60_000 });
  }

  const balloon = addLoanRpc();
  assertEquals((await callTool("add_loan", {
    idempotency_key: "k-b", name: "Example Note", principal: "100000", annual_rate_percent: 6,
    term_months: 60, start_date: "2026-01-01", kind: "balloon", amortization_months: 360,
  }, ["write"], balloon.rpc)).isError, false);
  const balloonBody = balloon.calls.find((call) => call.name === "mcp_add_loan")?.body;
  assertEquals(balloonBody?.p_payment_minor, 59_955);
  assertEquals([balloonBody?.p_kind, balloonBody?.p_amortization_months], ["balloon", 360]);

  const demand = addLoanRpc();
  const added = await callTool("add_loan", {
    idempotency_key: "k-d", name: "Example Partner", principal: "50000", annual_rate_percent: 0,
    start_date: "2026-01-01", kind: "demand",
  }, ["write"], demand.rpc);
  assertEquals(added.isError, false);
  const demandBody = demand.calls.find((call) => call.name === "mcp_add_loan")?.body;
  assertEquals([demandBody?.p_term_months, demandBody?.p_payment_minor, demandBody?.p_escrow_minor, demandBody?.p_kind], [null, null, 0, "demand"]);
  if (added.structuredContent.ok) {
    const data = added.structuredContent.data as { payment: unknown; schedule_preview: unknown[] };
    assertEquals([data.payment, data.schedule_preview], [null, []]);
  }
});

Deno.test("add_loan refuses kind fields that do not go together", async () => {
  const { calls, rpc } = addLoanRpc();
  const base = { idempotency_key: "k-bad", name: "Example Note", principal: "1000", annual_rate_percent: 5, start_date: "2026-01-01" };
  for (const [extra, message] of [
    [{ term_months: 12, interest_only_months: 3 }, "validation"],
    [{ term_months: 12, kind: "interest_only" }, "validation"],
    [{ term_months: 12, kind: "balloon" }, "validation"],
    [{ term_months: 12, kind: "balloon", amortization_months: 6 }, "amortization_months"],
    [{ term_months: 12, kind: "interest_only", interest_only_months: 13 }, "interest_only_months"],
    [{ kind: "demand", term_months: 12 }, "validation"],
    [{ kind: "demand", payment: "10" }, "validation"],
    [{ kind: "demand", escrow: "1" }, "validation"],
    [{}, "validation"],
    [{ kind: "revolving", term_months: 12 }, "validation"],
  ] as const) {
    const out = await callTool("add_loan", { ...base, ...extra }, ["write"], rpc);
    assertEquals(out.structuredContent, { ok: false, error: { code: "validation", message } }, JSON.stringify(extra));
  }
  assertEquals(calls.length, 0);
});

Deno.test("update_loan sets the kind and clears what the new kind does not have", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: LOAN, undo_kind: "loan_update" } } }));
  const patchOf = async (args: Record<string, unknown>) => {
    const out = await callTool("update_loan", { idempotency_key: "k-u", loan_id: LOAN, ...args }, ["write"], rpc);
    return out.isError ? out.structuredContent : calls.at(-1)?.body.p_patch;
  };
  assertEquals(await patchOf({ kind: "demand" }), {
    kind: "demand", interest_only_months: null, amortization_months: null, term_months: null, payment_minor: null, escrow_minor: 0,
  });
  assertEquals(await patchOf({ kind: "interest_only", interest_only_months: 6 }), { kind: "interest_only", interest_only_months: 6, amortization_months: null });
  assertEquals(await patchOf({ kind: "balloon", amortization_months: 360, term_months: 60 }), { term_months: 60, kind: "balloon", interest_only_months: null, amortization_months: 360 });
  assertEquals(await patchOf({ interest_only_months: 3 }), { interest_only_months: 3 });
  const before = calls.length;
  for (const bad of [
    { kind: "interest_only" },
    { kind: "balloon" },
    { kind: "amortizing", interest_only_months: 3 },
    { kind: "demand", term_months: 12 },
    { kind: "nope" },
  ]) {
    assertEquals(await patchOf(bad), { ok: false, error: { code: "validation", message: "validation" } }, JSON.stringify(bad));
  }
  assertEquals(calls.length, before);
});

Deno.test("set_loan_rate forwards the rate in ppm, null removes it, and undo takes loan_rate", async () => {
  const { calls, rpc } = rpcOf((name) => name === "mcp_set_loan_rate"
    ? { status: 200, json: { ok: true, data: { id: CATEGORY, loan_id: LOAN, undo_kind: "loan_rate" } } }
    : { status: 200, json: { ok: true, data: { kind: "loan_rate", id: CATEGORY } } });
  const out = await callTool("set_loan_rate", { idempotency_key: "r-1", loan_id: LOAN, effective_date: "2027-01-01", annual_rate_percent: "8.25" }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_set_loan_rate",
    body: { p_idempotency_key: "r-1", p_loan_id: LOAN, p_effective_date: "2027-01-01", p_annual_rate_ppm: 82_500 },
  });
  await callTool("set_loan_rate", { idempotency_key: "r-2", loan_id: LOAN, effective_date: "2027-01-01", annual_rate_percent: null }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body.p_annual_rate_ppm, null);
  const undo = await callTool("undo", { idempotency_key: "r-3", kind: "loan_rate", id: CATEGORY }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "r-3", p_kind: "loan_rate", p_id: CATEGORY } });
  const before = calls.length;
  for (const bad of [
    { effective_date: "2027-02-30", annual_rate_percent: 5 },
    { effective_date: "2027-01-01", annual_rate_percent: 101 },
    { effective_date: "2027-01-01", annual_rate_percent: -1 },
    { effective_date: "2027-01-01" },
    { effective_date: "20270101", annual_rate_percent: 5 },
  ]) {
    const refused = await callTool("set_loan_rate", { idempotency_key: "r-bad", loan_id: LOAN, ...bad }, ["write"], rpc);
    assertEquals(refused.structuredContent, { ok: false, error: { code: "validation", message: "validation" } }, JSON.stringify(bad));
  }
  assertEquals(calls.length, before);
  // The database's refusals pass through.
  for (const message of ["rate before the loan start", "rate not found", "loan not found"]) {
    const db = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "refused", message } } }));
    const refused = await callTool("set_loan_rate", { idempotency_key: "r-db", loan_id: LOAN, effective_date: "2027-01-01", annual_rate_percent: 5 }, ["write"], db.rpc);
    assertEquals(refused.structuredContent, { ok: false, error: { code: "refused", message } });
  }
});

const DEMAND_LOAN = {
  id: LOAN,
  name: "Example Partner",
  currency: "USD",
  principal_minor: 5_000_000,
  // 7.3%: 10.00 a day on 50,000.00.
  annual_rate_ppm: 73_000,
  term_months: null,
  start_date: "2026-01-01",
  payment_minor: null,
  escrow_minor: 0,
  balance_minor: 5_000_000,
  kind: "demand",
  rates: [],
};

Deno.test("attach_loan_payment on a demand loan: interest for the days since the last payment, the rest principal", async () => {
  // The earlier payment paid the 300.00 accrued to it, so nothing is carried.
  const earlier = paidRow("ffffffff-ffff-4000-8000-0000000000f1", { interestMinor: 30_000n, principalMinor: 1_000_000n }, { doc_date: "2026-01-31" });
  const loan = { ...DEMAND_LOAN, balance_minor: 4_000_000 };
  // 40,000.00 for 10 days at 7.3%: 80.00 of interest.
  const { calls, rpc } = feesRpc(loan, 108_000, "2026-02-10", null, [earlier]);
  const out = await callTool("attach_loan_payment", { idempotency_key: "d-1", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(attachedParts(calls), [
    { part: "interest", amount_minor: 8_000, scheduled_minor: 8_000 },
    { part: "escrow", amount_minor: 0, scheduled_minor: 0 },
    { part: "principal", amount_minor: 100_000, scheduled_minor: 100_000 },
  ]);

  // From the start when nothing is attached; at 0% the whole line is principal.
  const zero = feesRpc({ ...DEMAND_LOAN, annual_rate_ppm: 0 }, 250_000, "2026-06-01");
  assertEquals((await callTool("attach_loan_payment", { idempotency_key: "d-0", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], zero.rpc)).isError, false);
  assertEquals(attachedParts(zero.calls), [
    { part: "interest", amount_minor: 0, scheduled_minor: 0 },
    { part: "escrow", amount_minor: 0, scheduled_minor: 0 },
    { part: "principal", amount_minor: 250_000, scheduled_minor: 250_000 },
  ]);

  // A rate row in the period splits the days.
  const rated = feesRpc({ ...DEMAND_LOAN, rates: [{ effective_date: "2026-01-11", annual_rate_ppm: 146_000 }] }, 100_000, "2026-01-31");
  await callTool("attach_loan_payment", { idempotency_key: "d-r", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], rated.rpc);
  assertEquals((attachedParts(rated.calls) as Array<{ amount_minor: number }>)[0]?.amount_minor, 50_000);

  // A line smaller than the interest pays interest only (the shortfall comes out of principal first).
  const short = feesRpc(DEMAND_LOAN, 20_000, "2026-01-31");
  await callTool("attach_loan_payment", { idempotency_key: "d-s", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], short.rpc);
  assertEquals(attachedParts(short.calls), [
    { part: "interest", amount_minor: 20_000, scheduled_minor: 30_000 },
    { part: "escrow", amount_minor: 0, scheduled_minor: 0 },
    { part: "principal", amount_minor: 0, scheduled_minor: 0 },
  ]);
});

Deno.test("attach_loan_payment on a demand loan collects the interest a short payment left unpaid as interest first", async () => {
  // 50,000.00 at 8% from 2026-01-01: 986.30 by 2026-04-01. A 500.00 payment paid 500.00 of
  // it, so 486.30 is carried; 30 more days on 50,000.00 add 328.77.
  const loan = { ...DEMAND_LOAN, annual_rate_ppm: 80_000 };
  const short = paidRow("ffffffff-ffff-4000-8000-0000000000f1", { interestMinor: 50_000n, principalMinor: 0n }, { doc_date: "2026-04-01" });
  const { calls, rpc } = feesRpc(loan, 200_000, "2026-05-01", null, [short]);
  const out = await callTool("attach_loan_payment", { idempotency_key: "d-c", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(attachedParts(calls), [
    { part: "interest", amount_minor: 81_507, scheduled_minor: 81_507 },
    { part: "escrow", amount_minor: 0, scheduled_minor: 0 },
    { part: "principal", amount_minor: 118_493, scheduled_minor: 118_493 },
  ]);
  // get_loan_schedule shows the carried part of the interest due.
  const page = await callTool("get_loan_schedule", { loan_id: LOAN, as_of: "2026-05-01" }, ["read"], rpc);
  if (!page.structuredContent.ok) throw new Error("schedule failed");
  assertEquals((page.structuredContent.data as { accrued: unknown }).accrued, {
    as_of: "2026-05-01", since: "2026-04-01", days: 30, carried: "486.30", carried_minor: 48_630, interest: "815.07", interest_minor: 81_507, balance: "50000", balance_minor: 5_000_000,
  });
});

Deno.test("attach_loan_payment on a demand loan replays an attach after a later payment was attached", async () => {
  // The line was attached on 2026-02-01; a payment dated 2026-03-01 came after it. The same
  // attach again is a replay, not an out-of-order payment: it rebuilds the same parts.
  const later = paidRow("ffffffff-ffff-4000-8000-0000000000f1", { interestMinor: 18_000n, principalMinor: 100_000n }, { doc_date: "2026-03-01" });
  const own = paidRow(LOAN_TXN, { interestMinor: 31_000n, principalMinor: 69_000n }, { doc_date: "2026-02-01" });
  const split = {
    loan_id: LOAN,
    needs_review: false,
    parts: [{ part: "interest", amount_minor: 31_000 }, { part: "escrow", amount_minor: 0 }, { part: "principal", amount_minor: 69_000 }],
  };
  const loan = { ...DEMAND_LOAN, balance_minor: 5_000_000 - 169_000 };
  const { calls, rpc } = feesRpc(loan, 100_000, "2026-02-01", split, [own, later]);
  const out = await callTool("attach_loan_payment", { idempotency_key: "d-replay", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(attachedParts(calls), [
    { part: "interest", amount_minor: 31_000, scheduled_minor: 31_000 },
    { part: "escrow", amount_minor: 0, scheduled_minor: 0 },
    { part: "principal", amount_minor: 69_000, scheduled_minor: 69_000 },
  ]);
  // A line split on another loan is not a replay: the later payment still refuses it.
  const other = feesRpc(loan, 100_000, "2026-02-01", { ...split, loan_id: CATEGORY }, [later]);
  const refused = await callTool("attach_loan_payment", { idempotency_key: "d-other", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], other.rpc);
  assertEquals(refused.structuredContent, { ok: false, error: { code: "refused", message: "a later payment is already attached" } });
});

Deno.test("attach_loan_payment on a demand loan refuses installments, a date before the start or before an attached payment, and more than the balance", async () => {
  const later = paidRow("ffffffff-ffff-4000-8000-0000000000f1", { interestMinor: 0n, principalMinor: 100_000n }, { doc_date: "2026-03-01" });
  for (const [args, docDate, payments, message] of [
    [{ installments: 1 }, "2026-02-01", [], "a demand loan has no schedule rows"],
    [{}, "2025-12-31", [], "payment before the loan start"],
    [{}, "2026-02-01", [later], "a later payment is already attached"],
    [{}, "2026-02-01", [paidRow("ffffffff-ffff-4000-8000-0000000000f1", { interestMinor: 0n, principalMinor: 4_990_000n }, { doc_date: "2026-01-15", line_status: "pending" })], "loan balance exceeded"],
  ] as const) {
    const { calls, rpc } = feesRpc(DEMAND_LOAN, 100_000, docDate, null, [...payments]);
    const out = await callTool("attach_loan_payment", { idempotency_key: "d-bad", transaction_id: LOAN_TXN, loan_id: LOAN, ...args }, ["write"], rpc);
    assertEquals(out.structuredContent, { ok: false, error: { code: "refused", message } }, message);
    assertEquals(calls.some((call) => call.name === "mcp_attach_loan_payment"), false);
  }
  // The line's own earlier attach (a replay) and a payment waiting for review do not count.
  const own = paidRow(LOAN_TXN, { interestMinor: 0n, principalMinor: 100_000n }, { doc_date: "2026-03-01" });
  const flagged = { ...later, needs_review: true };
  const { calls, rpc } = feesRpc(DEMAND_LOAN, 100_000, "2026-02-01", null, [own, flagged]);
  assertEquals((await callTool("attach_loan_payment", { idempotency_key: "d-ok", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], rpc)).isError, false);
  assertEquals(calls.some((call) => call.name === "mcp_attach_loan_payment"), true);
});

Deno.test("attach_loan_payment exact parts need no schedule row for the date (FLOW-135 N3)", async () => {
  // Before the first due date there is no row: exact parts still attach, with scheduled 0.
  const { calls, rpc } = feesRpc(FEES_LOAN, 100_000, "2025-12-15");
  const out = await callTool("attach_loan_payment", {
    idempotency_key: "n3", transaction_id: LOAN_TXN, loan_id: LOAN, parts: { interest: "400", escrow: "100", principal: "500" },
  }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(attachedParts(calls), [
    { part: "interest", amount_minor: 40_000, scheduled_minor: 0 },
    { part: "escrow", amount_minor: 10_000, scheduled_minor: 0 },
    { part: "principal", amount_minor: 50_000, scheduled_minor: 0 },
  ]);
  // Without exact parts it is still refused.
  const plain = feesRpc(FEES_LOAN, 100_000, "2025-12-15");
  const refused = await callTool("attach_loan_payment", { idempotency_key: "n3-b", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], plain.rpc);
  assertEquals(refused.structuredContent, { ok: false, error: { code: "refused", message: "no schedule row for this date" } });
});

Deno.test("attach_loan_payment and get_loan_schedule follow an interest-only loan and its rate rows", async () => {
  const io = {
    ...FEES_LOAN,
    principal_minor: 12_000_000,
    annual_rate_ppm: 60_000,
    term_months: 24,
    payment_minor: 1_032_797,
    escrow_minor: 0,
    balance_minor: 12_000_000,
    kind: "interest_only",
    interest_only_months: 12,
    rates: [{ id: CATEGORY, effective_date: "2026-07-01", annual_rate_ppm: 120_000 }],
  };
  const { calls, rpc } = feesRpc(io, 120_000, "2026-07-01");
  await callTool("attach_loan_payment", { idempotency_key: "io-r", transaction_id: LOAN_TXN, loan_id: LOAN }, ["write"], rpc);
  // July is still interest only, at the new 12%: 1,200.00.
  assertEquals(attachedParts(calls), [
    { part: "interest", amount_minor: 120_000, scheduled_minor: 120_000 },
    { part: "escrow", amount_minor: 0, scheduled_minor: 0 },
    { part: "principal", amount_minor: 0, scheduled_minor: 0 },
  ]);
  const page = await callTool("get_loan_schedule", { loan_id: LOAN, from: 11, limit: 2 }, ["read"], rpc);
  if (!page.structuredContent.ok) throw new Error("schedule failed");
  const data = page.structuredContent.data as { kind: string; total: number; rows: Array<{ date: string; principal_minor: number; payment_minor: number }> };
  assertEquals([data.kind, data.total], ["interest_only", 24]);
  assertEquals(data.rows[0]?.principal_minor, 0);
  const recast = contractualPaymentMinor({ principalMinor: 12_000_000n, annualRatePpm: 120_000, termMonths: 12 });
  assertEquals(data.rows[1], { ...data.rows[1], date: "2027-01-01", payment_minor: Number(recast) });
});

Deno.test("get_loan_schedule on a demand loan lists the payments and the interest accrued to as_of", async () => {
  const payments = [
    paidRow("ffffffff-ffff-4000-8000-0000000000f1", { interestMinor: 30_000n, principalMinor: 1_000_000n }, { doc_date: "2026-01-31" }),
    paidRow("ffffffff-ffff-4000-8000-0000000000f2", { interestMinor: 5_000n, principalMinor: 5_000n }, { doc_date: "2026-02-15", needs_review: true }),
  ];
  const { calls, rpc } = feesRpc(DEMAND_LOAN, 0, "2026-01-01", null, payments);
  const out = await callTool("get_loan_schedule", { loan_id: LOAN, as_of: "2026-03-02" }, ["read"], rpc);
  assertEquals(out.isError, false);
  assertEquals(calls.find((call) => call.name === "mcp_loan_payments")?.body, { p_loan_id: LOAN });
  if (!out.structuredContent.ok) throw new Error("schedule failed");
  const data = out.structuredContent.data as Record<string, unknown> & { rows: Array<Record<string, unknown>> };
  assertEquals([data.kind, data.total, data.rows.length], ["demand", 1, 1]);
  assertEquals(data.rows[0], { ...data.rows[0], date: "2026-01-31", interest_minor: 30_000, principal_minor: 1_000_000, payment_minor: 1_030_000, balance_minor: 4_000_000 });
  // 40,000.00 for 30 days at 7.3%: 240.00.
  assertEquals(data.accrued, {
    as_of: "2026-03-02", since: "2026-01-31", days: 30, carried: "0", carried_minor: 0, interest: "240", interest_minor: 24_000, balance: "40000", balance_minor: 4_000_000,
  });
  const bad = await callTool("get_loan_schedule", { loan_id: LOAN, as_of: "2026-02-30" }, ["read"], rpc);
  assertEquals(bad.structuredContent, { ok: false, error: { code: "validation", message: "validation" } });
});

Deno.test("loan kind tools are described", () => {
  const write = toolsFor(["write"]);
  const read = toolsFor(["read"]);
  const spec = (list: ReturnType<typeof toolsFor>, name: string) => list.find((tool) => tool.name === name);
  assertEquals(Object.keys(spec(write, "set_loan_rate")?.inputSchema.properties ?? {}), ["idempotency_key", "loan_id", "effective_date", "annual_rate_percent"]);
  for (const words of ["rate before the loan start", "undo is kind loan_rate", "recasts the payment"]) {
    assertEquals(spec(write, "set_loan_rate")?.description.includes(words), true, words);
  }
  for (const name of ["add_loan", "update_loan"]) {
    assertEquals(Object.keys(spec(write, name)?.inputSchema.properties ?? {}).slice(-3), ["kind", "interest_only_months", "amortization_months"]);
  }
  for (const words of ["a demand loan has no schedule rows", "a later payment is already attached", "payment before the loan start", "0 when no row fits the date"]) {
    assertEquals(spec(write, "attach_loan_payment")?.description.includes(words), true, words);
  }
  assertEquals(Object.keys(spec(read, "get_loan_schedule")?.inputSchema.properties ?? {}), ["loan_id", "from", "limit", "as_of"]);
  assertEquals(spec(read, "list_loans")?.description.includes("rates lists"), true);
  assertEquals((spec(write, "undo")?.inputSchema.properties.kind as { enum: string[] }).enum.includes("loan_rate"), true);
});

Deno.test("list_unpaid returns minor units and open and marked totals per currency and direction", async () => {
  const rows = [
    { id: TXN, description: "Invoice 1", doc_date: "2026-06-01", currency: "ILS", direction: "income", project_name: "North", customer_name: "Client A", open_gross_agorot: 11800, open_net_agorot: 10000, marked_paid_at: null },
    { id: PROJECT, description: "Invoice 2", doc_date: "2026-06-02", currency: "ILS", direction: "income", project_name: null, customer_name: "Client B", open_gross_agorot: 5900, open_net_agorot: 5000, marked_paid_at: "2026-06-10T08:00:00+00:00" },
    { id: PROJECT_B, description: "Invoice 3", doc_date: "2026-06-03", currency: "USD", direction: "income", project_name: null, customer_name: null, open_gross_agorot: 2500, open_net_agorot: 2500, marked_paid_at: null },
    { id: CATEGORY, description: "Supplier bill", doc_date: "2026-06-04", currency: "ILS", direction: "expense", project_name: null, customer_name: null, open_gross_agorot: -5000, open_net_agorot: -5000, marked_paid_at: null },
  ];
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: rows }));
  const out = await callTool("list_unpaid", {}, ["read"], rpc);
  assertEquals(out.isError, false);
  assertEquals(calls[0], { name: "list_unpaid", body: {} });
  if (!out.structuredContent.ok) throw new Error("expected ok");
  const data = out.structuredContent.data as { invoices: Record<string, unknown>[]; totals: unknown[] };
  assertEquals(data.invoices[1], {
    id: PROJECT, description: "Invoice 2", doc_date: "2026-06-02", currency: "ILS", direction: "income", project_name: null,
    customer_name: "Client B", open_gross_minor: 5900, open_net_minor: 5000, marked_paid_at: "2026-06-10T08:00:00+00:00",
  });
  assertEquals(data.totals, [
    { currency: "ILS", direction: "expense", open_gross_minor: -5000, marked_gross_minor: 0 },
    { currency: "ILS", direction: "income", open_gross_minor: 11800, marked_gross_minor: 5900 },
    { currency: "USD", direction: "income", open_gross_minor: 2500, marked_gross_minor: 0 },
  ]);
  assertEquals((await callTool("list_unpaid", { company_id: TXN }, ["read"], rpc)).isError, true);
  assertEquals((await callTool("list_unpaid", {}, ["read"], () => Promise.resolve({ status: 403, json: null }))).isError, true);
  assertEquals((await callTool("list_unpaid", {}, ["read"], () => Promise.resolve({ status: 200, json: { rows } }))).isError, true);
  assertEquals((await callTool("list_unpaid", {}, ["write"], rpc)).isError, true);
});

Deno.test("set_invoice_paid forwards paid and undo takes kind invoice_paid", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { transaction_id: TXN, marked_paid: true, undo_kind: "invoice_paid", id: TXN } },
  }));
  const out = await callTool("set_invoice_paid", { idempotency_key: "m-1", transaction_id: TXN, paid: true }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(calls[0], {
    name: "mcp_set_invoice_paid",
    body: { p_idempotency_key: "m-1", p_transaction_id: TXN, p_paid: true },
  });
  const cleared = await callTool("set_invoice_paid", { idempotency_key: "m-2", transaction_id: TXN, paid: false }, ["write"], rpc);
  assertEquals(cleared.isError, false);
  assertEquals(calls[1]?.body.p_paid, false);
  const undo = await callTool("undo", { idempotency_key: "u-1", kind: "invoice_paid", id: TXN }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls[2], { name: "mcp_undo", body: { p_idempotency_key: "u-1", p_kind: "invoice_paid", p_id: TXN } });
});

Deno.test("set_invoice_paid validates input, refuses read tokens and passes the fixed refusal", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "refused", message: "invoice not found" } } }));
  const denied = await callTool("set_invoice_paid", { idempotency_key: "k", transaction_id: TXN, paid: true }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const bad: unknown[] = [
    { idempotency_key: "k", transaction_id: TXN },
    { idempotency_key: "k", transaction_id: TXN, paid: null },
    { idempotency_key: "k", transaction_id: TXN, paid: "yes" },
    { idempotency_key: "k", transaction_id: "not-a-uuid", paid: true },
    { idempotency_key: "", transaction_id: TXN, paid: true },
    { idempotency_key: "k", transaction_id: TXN, paid: true, company_id: TXN },
  ];
  for (const input of bad) {
    const result = await callTool("set_invoice_paid", input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
  const refused = await callTool("set_invoice_paid", { idempotency_key: "k", transaction_id: TXN, paid: true }, ["write"], rpc);
  assertEquals(refused.isError, true);
  if (!refused.structuredContent.ok) assertEquals(refused.structuredContent.error.message, "invoice not found");
});

Deno.test("list_loans shows interest and escrow as the payment when the interest-only months are the term (FLOW-136)", async () => {
  const bullet = {
    id: LOAN,
    name: "Example Bridge",
    currency: "USD",
    principal_minor: 12000000,
    annual_rate_ppm: 60000,
    term_months: 12,
    start_date: "2026-01-01",
    payment_minor: 12070000,
    escrow_minor: 10000,
    balance_minor: 12000000,
    kind: "interest_only",
    interest_only_months: 12,
  };
  const partial = { ...bullet, id: LOAN_TXN, term_months: 24, payment_minor: 541000 };
  const { rpc } = rpcOf((name) => (name === "mcp_list_loans" ? { status: 200, json: [bullet, partial] } : { status: 500, json: null }));
  const listed = await callTool("list_loans", {}, ["read"], rpc);
  if (!listed.structuredContent.ok) throw new Error("list_loans failed");
  const loans = (listed.structuredContent.data as { loans: typeof bullet[] }).loans;
  assertEquals(loans.map((loan) => loan.payment_minor), [70000, 541000]);
});

Deno.test("get_jev_suggestions takes no arguments and passes the SQL result through", async () => {
  const calls: Array<[string, unknown]> = [];
  const payload = {
    suggestions: [{ transaction_id: "t", direction: "income", reason: "same_as_last", party_filings: 3, matching_filings: 3 }],
  };
  const rpc = (name: string, body: unknown) => {
    calls.push([name, body]);
    return Promise.resolve({ status: 200, json: payload });
  };
  assertEquals((await callTool("get_jev_suggestions", {}, ["read"], rpc)).structuredContent, { ok: true, data: payload });
  assertEquals(calls, [["mcp_jev_suggestions", {}]]);
  assertEquals((await callTool("get_jev_suggestions", { limit: 5 }, ["read"], rpc)).isError, true);
  assertEquals((await callTool("get_jev_suggestions", {}, ["read"], () => Promise.resolve({ status: 200, json: [] }))).isError, true);
  assertEquals((await callTool("get_jev_suggestions", {}, ["read"], () => Promise.resolve({ status: 403, json: null }))).isError, true);
  assertEquals((await callTool("get_jev_suggestions", {}, ["write"], rpc)).isError, true);
  assertEquals(calls.length, 1);
});

Deno.test("detach_loan_payment forwards the line and undo takes kind loan_detach", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { transaction_id: TXN, loan_id: TXN, parts: [], undo_kind: "loan_detach", id: TXN } },
  }));
  const out = await callTool("detach_loan_payment", { idempotency_key: "d-1", transaction_id: TXN }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(calls[0], {
    name: "mcp_detach_loan_payment",
    body: { p_idempotency_key: "d-1", p_transaction_id: TXN },
  });
  const undo = await callTool("undo", { idempotency_key: "u-1", kind: "loan_detach", id: TXN }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls[1], { name: "mcp_undo", body: { p_idempotency_key: "u-1", p_kind: "loan_detach", p_id: TXN } });
});

Deno.test("delete_loan and reorder_loans forward their input, undo takes loan_delete and loan_order (FLOW-110)", async () => {
  const other = "11111111-1111-4000-8000-000000000110";
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "loan_delete", id: TXN } } }));
  const deleted = await callTool("delete_loan", { idempotency_key: "dl-1", loan_id: TXN.toUpperCase() }, ["write"], rpc);
  assertEquals(deleted.isError, false);
  assertEquals(calls[0], { name: "mcp_delete_loan", body: { p_idempotency_key: "dl-1", p_loan_id: TXN } });
  const ordered = await callTool("reorder_loans", { idempotency_key: "ro-1", loan_ids: [other, TXN] }, ["write"], rpc);
  assertEquals(ordered.isError, false);
  assertEquals(calls[1], { name: "mcp_reorder_loans", body: { p_idempotency_key: "ro-1", p_loan_ids: [other, TXN] } });
  for (const kind of ["loan_delete", "loan_order"]) {
    const undo = await callTool("undo", { idempotency_key: "u-" + kind, kind, id: TXN }, ["write"], rpc);
    assertEquals(undo.isError, false);
    assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "u-" + kind, p_kind: kind, p_id: TXN } });
  }

  const denied = await callTool("delete_loan", { idempotency_key: "k", loan_id: TXN }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const before = calls.length;
  for (const [tool, input] of [
    ["delete_loan", { idempotency_key: "k" }],
    ["delete_loan", { idempotency_key: "k", loan_id: "not-a-uuid" }],
    ["delete_loan", { idempotency_key: "k", loan_id: TXN, transaction_id: TXN }],
    ["reorder_loans", { idempotency_key: "k", loan_ids: [] }],
    ["reorder_loans", { idempotency_key: "k", loan_ids: ["not-a-uuid"] }],
    ["reorder_loans", { idempotency_key: "k", loan_ids: TXN }],
  ] as const) {
    const result = await callTool(tool, input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);
});

Deno.test("set_project_investment and set_category_rehab forward their input, undo takes both kinds (FLOW-404)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "project_investment", id: TXN } } }));
  const set = await callTool("set_project_investment", {
    idempotency_key: "pi-1", project_id: TXN.toUpperCase(), arv_minor: 150000000, purchase_minor: null, value_date: "2026-09-30", currency: "USD",
  }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls[0], {
    name: "mcp_set_project_investment",
    body: { p_idempotency_key: "pi-1", p_project_id: TXN, p_patch: { currency: "USD", purchase_minor: null, arv_minor: 150000000, value_date: "2026-09-30" } },
  });
  for (const rehab of [true, false, null]) {
    const switched = await callTool("set_category_rehab", { idempotency_key: "cr-1", category_id: TXN, rehab }, ["write"], rpc);
    assertEquals(switched.isError, false);
    assertEquals(calls.at(-1), { name: "mcp_set_category_rehab", body: { p_idempotency_key: "cr-1", p_category_id: TXN, p_rehab: rehab } });
  }
  for (const kind of ["project_investment", "category_rehab"]) {
    const undo = await callTool("undo", { idempotency_key: "u-" + kind, kind, id: TXN }, ["write"], rpc);
    assertEquals(undo.isError, false);
    assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "u-" + kind, p_kind: kind, p_id: TXN } });
  }

  const denied = await callTool("set_category_rehab", { idempotency_key: "k", category_id: TXN, rehab: true }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const before = calls.length;
  for (const [tool, input] of [
    ["set_project_investment", { idempotency_key: "k", project_id: TXN }],
    ["set_project_investment", { idempotency_key: "k", project_id: TXN, arv_minor: -1 }],
    ["set_project_investment", { idempotency_key: "k", project_id: TXN, arv_minor: 12.5 }],
    ["set_project_investment", { idempotency_key: "k", project_id: TXN, currency: "usd" }],
    ["set_project_investment", { idempotency_key: "k", project_id: TXN, currency: null }],
    ["set_project_investment", { idempotency_key: "k", project_id: TXN, arv_minor: "100" }],
    ["set_project_investment", { idempotency_key: "k", project_id: TXN, value_date: "2026-02-30" }],
    ["set_project_investment", { idempotency_key: "k", project_id: TXN, budget_agorot: 1 }],
    ["set_project_investment", { idempotency_key: "k", project_id: "not-a-uuid", arv_minor: 1 }],
    ["set_category_rehab", { idempotency_key: "k", category_id: TXN }],
    ["set_category_rehab", { idempotency_key: "k", category_id: TXN, rehab: "yes" }],
    ["set_category_rehab", { idempotency_key: "k", category_id: "not-a-uuid", rehab: true }],
  ] as const) {
    const result = await callTool(tool, input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);
});

Deno.test("detach_loan_payment validates input, refuses read tokens and passes the fixed refusal", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "refused", message: "line has no loan split" } } }));
  const denied = await callTool("detach_loan_payment", { idempotency_key: "k", transaction_id: TXN }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const bad: unknown[] = [
    { idempotency_key: "k" },
    { idempotency_key: "k", transaction_id: "not-a-uuid" },
    { idempotency_key: "", transaction_id: TXN },
    { idempotency_key: "k", transaction_id: TXN, loan_id: TXN },
  ];
  for (const input of bad) {
    const result = await callTool("detach_loan_payment", input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
  const refused = await callTool("detach_loan_payment", { idempotency_key: "k", transaction_id: TXN }, ["write"], rpc);
  assertEquals(refused.isError, true);
  if (!refused.structuredContent.ok) assertEquals(refused.structuredContent.error.message, "line has no loan split");
});

Deno.test("undo_jev_prefill forwards the line, refuses read tokens and passes conflicts through", async () => {
  let reply: unknown = { ok: true, data: { transaction_id: TXN, project_id: null, category_id: null } };
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: reply }));
  const out = await callTool("undo_jev_prefill", { idempotency_key: "j-1", transaction_id: TXN.toUpperCase() }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(calls[0], { name: "mcp_undo_jev_prefill", body: { p_idempotency_key: "j-1", p_transaction_id: TXN } });
  const denied = await callTool("undo_jev_prefill", { idempotency_key: "k", transaction_id: TXN }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  for (const input of [{ idempotency_key: "k" }, { idempotency_key: "k", transaction_id: "x" }, { idempotency_key: "k", transaction_id: TXN, project_id: TXN }]) {
    const result = await callTool("undo_jev_prefill", input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 1);
  reply = { ok: false, error: { code: "conflict", message: "line changed since" } };
  const changed = await callTool("undo_jev_prefill", { idempotency_key: "k", transaction_id: TXN }, ["write"], rpc);
  assertEquals(changed.isError, true);
  if (!changed.structuredContent.ok) assertEquals(changed.structuredContent.error.code, "conflict");
});

Deno.test("get_expense takes the loan split from get_transaction when it carries one", async () => {
  const split = { loan_id: TXN, loan_name: "Example loan", needs_review: false, by_parts: true, parts: [] };
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_transaction") return { status: 200, json: { id: TXN, direction: "expense", loan_split: split } };
    if (name === "get_line_split") return { status: 200, json: null };
    return { status: 200, json: [] };
  });
  const out = await callTool("get_expense", { transaction_id: TXN }, ["read"], rpc);
  assertEquals(out.isError, false);
  if (out.structuredContent.ok) assertEquals((out.structuredContent.data as { loan_split: unknown }).loan_split, split);
  assertEquals(calls.some((call) => call.name === "get_loan_split"), false, "no second read");
});

Deno.test("delete_category and move_category_lines forward their input, undo takes both kinds (FLOW-405)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "category_delete", id: CATEGORY } } }));
  const deleted = await callTool("delete_category", { idempotency_key: "cd-1", category_id: CATEGORY.toUpperCase() }, ["write"], rpc);
  assertEquals(deleted.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_delete_category", body: { p_idempotency_key: "cd-1", p_category_id: CATEGORY } });
  const moved = await callTool("move_category_lines", {
    idempotency_key: "cm-1", from_category_id: CATEGORY, into_category_id: INCOME_CATEGORY,
  }, ["write"], rpc);
  assertEquals(moved.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_move_category_lines", body: { p_idempotency_key: "cm-1", p_from: CATEGORY, p_into: INCOME_CATEGORY } });
  for (const kind of ["category_delete", "category_move"]) {
    const undo = await callTool("undo", { idempotency_key: "u-" + kind, kind, id: CATEGORY }, ["write"], rpc);
    assertEquals(undo.isError, false);
    assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "u-" + kind, p_kind: kind, p_id: CATEGORY } });
  }

  const denied = await callTool("delete_category", { idempotency_key: "k", category_id: CATEGORY }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const before = calls.length;
  for (const [tool, input] of [
    ["delete_category", { idempotency_key: "k" }],
    ["delete_category", { idempotency_key: "k", category_id: "not-a-uuid" }],
    ["delete_category", { idempotency_key: "k", category_id: CATEGORY, force: true }],
    ["move_category_lines", { idempotency_key: "k", from_category_id: CATEGORY }],
    ["move_category_lines", { idempotency_key: "k", from_category_id: CATEGORY, into_category_id: "not-a-uuid" }],
    ["move_category_lines", { idempotency_key: "k", from: CATEGORY, into: INCOME_CATEGORY }],
  ] as const) {
    const result = await callTool(tool, input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);
});

Deno.test("rename_category forwards its input, undo takes category_name", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "category_name", id: CATEGORY } } }));
  const renamed = await callTool("rename_category", { idempotency_key: "rn-1", category_id: CATEGORY.toUpperCase(), name: "חשמל" }, ["write"], rpc);
  assertEquals(renamed.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_rename_category", body: { p_idempotency_key: "rn-1", p_category_id: CATEGORY, p_name: "חשמל" } });
  const undo = await callTool("undo", { idempotency_key: "u-rn", kind: "category_name", id: CATEGORY }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "u-rn", p_kind: "category_name", p_id: CATEGORY } });

  const denied = await callTool("rename_category", { idempotency_key: "k", category_id: CATEGORY, name: "חשמל" }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const before = calls.length;
  for (const input of [
    { idempotency_key: "k", category_id: CATEGORY },
    { idempotency_key: "k", category_id: CATEGORY, name: "א" },
    { idempotency_key: "k", category_id: CATEGORY, name: "א".repeat(121) },
    { idempotency_key: "k", category_id: "not-a-uuid", name: "חשמל" },
    { idempotency_key: "k", category_id: CATEGORY, name: "חשמל", kind: "expense" },
  ]) {
    const result = await callTool("rename_category", input, ["write"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);
});

Deno.test("get_project_categories and set_category_group forward their input (FLOW-401)", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "project_category_months") return { status: 200, json: { project_id: CATEGORY, months: [], categories: [] } };
    return { status: 200, json: { ok: true, data: { undo_kind: "category_group", id: CATEGORY } } };
  });
  const months = await callTool("get_project_categories", { id: CATEGORY.toUpperCase() }, ["read"], rpc);
  assertEquals(months.isError, false);
  assertEquals(calls.at(-1), { name: "project_category_months", body: { p_project_id: CATEGORY, p_months: 6 } });
  await callTool("get_project_categories", { id: CATEGORY, months: 12 }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body.p_months, 12);

  const set = await callTool("set_category_group", { idempotency_key: "cg-1", category_id: CATEGORY, group_name: "חשבונות" }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_set_category_group", body: { p_idempotency_key: "cg-1", p_category_id: CATEGORY, p_group_name: "חשבונות" } });
  await callTool("set_category_group", { idempotency_key: "cg-2", category_id: CATEGORY, group_name: null }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body.p_group_name, null);
  const undo = await callTool("undo", { idempotency_key: "u-cg", kind: "category_group", id: CATEGORY }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "u-cg", p_kind: "category_group", p_id: CATEGORY } });

  const before = calls.length;
  for (const [tool, input] of [
    ["get_project_categories", {}],
    ["get_project_categories", { id: "not-a-uuid" }],
    ["get_project_categories", { id: CATEGORY, months: 2 }],
    ["get_project_categories", { id: CATEGORY, months: 13 }],
    ["get_project_categories", { id: CATEGORY, months: 6.5 }],
    ["set_category_group", { idempotency_key: "k", category_id: CATEGORY }],
    ["set_category_group", { idempotency_key: "k", category_id: CATEGORY, group_name: "א".repeat(41) }],
    ["set_category_group", { idempotency_key: "k", category_id: CATEGORY, group_name: "חשבונות\u202E" }],
    ["set_category_group", { idempotency_key: "k", category_id: "not-a-uuid", group_name: "x" }],
  ] as const) {
    const scope = tool === "get_project_categories" ? ["read"] : ["write"];
    const result = await callTool(tool, input, scope, rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);

  const { rpc: missing } = rpcOf(() => ({ status: 200, json: null }));
  const notFound = await callTool("get_project_categories", { id: CATEGORY }, ["read"], missing);
  assertEquals(notFound.isError, true);
  if (!notFound.structuredContent.ok) assertEquals(notFound.structuredContent.error.code, "not_found");
});

Deno.test("set_jev_mode forwards the switch, mode and threshold, undo takes jev_mode (#231 r1)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "jev_mode", mode: "auto" } } }));
  const set = await callTool("set_jev_mode", { idempotency_key: "jm-1", enabled: true, mode: "auto", threshold: 0.85 }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_set_jev_mode", body: { p_idempotency_key: "jm-1", p_enabled: true, p_mode: "auto", p_threshold: 0.85 } });
  await callTool("set_jev_mode", { idempotency_key: "jm-2", enabled: false }, ["write"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_set_jev_mode", body: { p_idempotency_key: "jm-2", p_enabled: false, p_mode: null, p_threshold: null } });
  const undo = await callTool("undo", { idempotency_key: "u-jm", kind: "jev_mode", id: CATEGORY }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "u-jm", p_kind: "jev_mode", p_id: CATEGORY } });

  const denied = await callTool("set_jev_mode", { idempotency_key: "k", enabled: true }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const before = calls.length;
  for (const input of [
    { idempotency_key: "k" },
    { idempotency_key: "k", enabled: "yes" },
    { idempotency_key: "k", enabled: true, mode: "live" },
    { idempotency_key: "k", enabled: true, threshold: 0.49 },
    { idempotency_key: "k", enabled: true, threshold: 1.01 },
    { idempotency_key: "k", enabled: true, company_id: CATEGORY },
  ]) {
    const result = await callTool("set_jev_mode", input, ["write"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);
});

Deno.test("set_company_currency forwards the code, undo takes company_currency (FLOW-504)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "company_currency", base_currency: "USD" } } }));
  const set = await callTool("set_company_currency", { idempotency_key: "cc-1", currency: "USD" }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_set_company_currency", body: { p_idempotency_key: "cc-1", p_currency: "USD" } });
  const undo = await callTool("undo", { idempotency_key: "u-cc", kind: "company_currency", id: CATEGORY }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "u-cc", p_kind: "company_currency", p_id: CATEGORY } });

  const denied = await callTool("set_company_currency", { idempotency_key: "k", currency: "USD" }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const before = calls.length;
  for (const input of [
    { idempotency_key: "k" },
    { idempotency_key: "k", currency: "usd" },
    { idempotency_key: "k", currency: "DOLLAR" },
    { idempotency_key: "k", currency: "USD", company_id: CATEGORY },
  ]) {
    const result = await callTool("set_company_currency", input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);
});

Deno.test("list_review supplier filter finds an income line by its customer", async () => {
  const rows = [
    { id: "q1", transaction_id: "t1", direction: "income", supplier_name: null, customer_name: "דירות הים", doc_date: "2026-09-10" },
    { id: "q2", transaction_id: "t2", direction: "expense", supplier_name: "חומרי הים", customer_name: null, doc_date: "2026-09-11" },
    { id: "q3", transaction_id: "t3", direction: "expense", supplier_name: "שיש", customer_name: null, doc_date: "2026-09-12" },
  ];
  const { rpc } = rpcOf((name) => {
    if (name === "list_review") return { status: 200, json: rows };
    if (name === "get_line_meta") return { status: 200, json: [] };
    return { status: 500, json: null };
  });
  const page = await callTool("list_review", { supplier: "הים" }, ["read"], rpc);
  assertEquals(page.isError, false);
  if (page.structuredContent.ok) {
    const data = page.structuredContent.data as { total: number; reviews: { id: string }[] };
    assertEquals(data.reviews.map((row) => row.id), ["q1", "q2"]);
  }
});
