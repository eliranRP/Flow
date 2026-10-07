import { assertEquals } from "jsr:@std/assert@1";
import {
  allocateLoanSplit,
  scheduleRowForDate,
} from "../../../packages/shared/src/loan-split.ts";
import {
  buildLoanSchedule,
  contractualPaymentMinor,
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

function rpcOf(handler: (name: string, body: Record<string, unknown>) => { status: number; json: unknown }) {
  const calls: Rpc[] = [];
  const rpc = (name: string, body: Record<string, unknown>) => {
    calls.push({ name, body });
    return Promise.resolve(handler(name, body));
  };
  return { calls, rpc };
}

Deno.test("search_expenses filed and all call search_transactions", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { total: 1, expenses: [{ id: "11111111-1111-4000-8000-000000000001" }] },
  }));
  const filed = await callTool("search_expenses", { scope: "filed", query: "אלפא" }, ["read"], rpc);
  assertEquals(filed.isError, false);
  assertEquals(calls[0]?.name, "search_transactions");
  assertEquals(calls[0]?.body.p_scope, "filed");
  const all = await callTool("search_expenses", { scope: "all" }, ["read"], rpc);
  assertEquals(all.isError, false);
  assertEquals(calls[1]?.name, "search_transactions");
  assertEquals(calls[1]?.body.p_scope, "all");
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
  assertEquals(schedule.isError, false);
  assertEquals(calls.map((call) => call.name), [
    "get_dashboard",
    "list_categories",
    "list_review",
    "get_transaction",
    "list_review",
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
    if (name === "search_transactions") return { status: 200, json: { total: 0, expenses: [] } };
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
    "sync_bank",
    "hide_category",
    "set_category_pnl",
    "set_overhead_project",
    "add_loan",
    "update_loan",
    "attach_loan_payment",
    "undo",
    "undo_batch",
  ]);
  for (const tool of toolsFor(["write"])) {
    assertEquals(tool.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  }
  assertEquals(toolsFor(["read", "write"]).map((tool) => tool.name), [
    "list_projects",
    "get_project",
    "list_categories",
    "list_review",
    "get_expense",
    "search_expenses",
    "get_totals",
    "list_loans",
    "get_loan_schedule",
    "assign_expense",
    "assign_expense_split",
    "assign_expenses",
    "set_expense_category",
    "create_project",
    "create_category",
    "sync_bank",
    "hide_category",
    "set_category_pnl",
    "set_overhead_project",
    "add_loan",
    "update_loan",
    "attach_loan_payment",
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

Deno.test("sync_bank proceed, replay, errors, and skipped", async () => {
  const invokeCalls: { fn: string; body: Record<string, unknown> }[] = [];
  const invoke = (fn: string, body: Record<string, unknown>) => {
    invokeCalls.push({ fn, body });
    return Promise.resolve({
      status: 200,
      json: { ok: true, lines: 2, inserted: 1, updated: 1, removed: 0, newest_date: "2026-09-15" },
    });
  };
  let beginCount = 0;
  const rpc = (name: string, body: Record<string, unknown>) => {
    if (name === "mcp_sync_bank_begin") {
      beginCount += 1;
      if (beginCount === 1) {
        return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed" } } });
      }
      return Promise.resolve({
        status: 200,
        json: { ok: true, data: { added: 1, duplicates: 1, removed: 0, newest_date: "2026-09-15" } },
      });
    }
    if (name === "mcp_sync_bank_finish") {
      return Promise.resolve({ status: 200, json: null });
    }
    return Promise.resolve({ status: 500, json: null });
  };
  const first = await callTool("sync_bank", { idempotency_key: "sync-1" }, ["write"], rpc, invoke);
  assertEquals(first.isError, false);
  if (first.structuredContent.ok) {
    assertEquals(first.structuredContent.data, {
      added: 1,
      duplicates: 1,
      removed: 0,
      newest_date: "2026-09-15",
    });
  }
  assertEquals(invokeCalls, [{ fn: "mercury-sync", body: { force: true } }]);
  invokeCalls.length = 0;
  const replay = await callTool("sync_bank", { idempotency_key: "sync-1" }, ["write"], rpc, invoke);
  assertEquals(replay.isError, false);
  assertEquals(invokeCalls.length, 0);

  const noConn = await callTool("sync_bank", { idempotency_key: "sync-2" }, ["write"], (name) => {
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({
        status: 200,
        json: { ok: false, error: { code: "not_found", message: "bank is not connected" } },
      });
    }
    return Promise.resolve({ status: 200, json: null });
  }, invoke);
  assertEquals(noConn.isError, true);
  if (!noConn.structuredContent.ok) {
    assertEquals(noConn.structuredContent.error.code, "not_found");
    assertEquals(noConn.structuredContent.error.message, "bank is not connected");
  }

  const skipped = await callTool("sync_bank", { idempotency_key: "sync-3" }, ["write"], (name) => {
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed" } } });
    }
    return Promise.resolve({ status: 200, json: null });
  }, () => Promise.resolve({ status: 200, json: { ok: true, lines: 0, skipped: true } }));
  assertEquals(skipped.isError, true);
  if (!skipped.structuredContent.ok) assertEquals(skipped.structuredContent.error.code, "unavailable");

  const rate = await callTool("sync_bank", { idempotency_key: "sync-4" }, ["write"], (name) => {
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed" } } });
    }
    return Promise.resolve({ status: 200, json: null });
  }, () => Promise.resolve({ status: 429, json: { error: "rate_limited" } }));
  assertEquals(rate.isError, true);
  if (!rate.structuredContent.ok) assertEquals(rate.structuredContent.error.message, "retry");

  const gone = await callTool("sync_bank", { idempotency_key: "sync-4b" }, ["write"], (name) => {
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed" } } });
    }
    return Promise.resolve({ status: 200, json: null });
  }, () => Promise.resolve({ status: 500, json: { error: "Mercury is not connected" } }));
  assertEquals(gone.isError, true);
  if (!gone.structuredContent.ok) assertEquals(gone.structuredContent.error.code, "not_found");

  const auth = await callTool("sync_bank", { idempotency_key: "sync-5" }, ["write"], (name) => {
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed" } } });
    }
    return Promise.resolve({ status: 200, json: null });
  }, () => Promise.resolve({ status: 500, json: { error: "auth" } }));
  assertEquals(auth.isError, true);
  if (!auth.structuredContent.ok) {
    assertEquals(auth.structuredContent.error.message, "bank key was rejected; reconnect in Settings");
  }

  const unauthorized = await callTool("sync_bank", { idempotency_key: "sync-6" }, ["write"], (name) => {
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed" } } });
    }
    return Promise.resolve({ status: 200, json: null });
  }, () => Promise.resolve({ status: 401, json: null }));
  assertEquals(unauthorized.isError, true);
  if (!unauthorized.structuredContent.ok) assertEquals(unauthorized.structuredContent.error.code, "unavailable");

  const failed = await callTool("sync_bank", { idempotency_key: "sync-7" }, ["write"], (name) => {
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed" } } });
    }
    return Promise.resolve({ status: 200, json: null });
  }, () => Promise.resolve({ status: 500, json: { error: "sync_failed" } }));
  assertEquals(failed.isError, true);
  if (!failed.structuredContent.ok) assertEquals(failed.structuredContent.error.message, "The bank sync failed.");

  const noInvoke = await callTool("sync_bank", { idempotency_key: "sync-8" }, ["write"], (name) => {
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed" } } });
    }
    return Promise.resolve({ status: 200, json: null });
  });
  assertEquals(noInvoke.isError, true);
  if (!noInvoke.structuredContent.ok) assertEquals(noInvoke.structuredContent.error.code, "unavailable");
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
  assertEquals(calls[2]?.body.p_parts, expected.map((part) => ({
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
    },
    additionalProperties: false,
  });
  assertEquals(spec?.description.includes("cash"), true);
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
