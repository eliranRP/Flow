import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";

const TXN = "22222222-2222-4000-8000-000000000020";
const PROJECT = "8c1a0b2e-1111-4000-8000-000000000001";
const CATEGORY = "c0ffee00-1111-4000-8000-0000000000a1";
const REVIEW = "11111111-1111-4000-8000-000000000010";

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

Deno.test("the six read tools call their own functions", async () => {
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_dashboard") {
      return { status: 200, json: { company_id: "company-a", name: "א", projects: [], basis: "cash", income_agorot: 1, direct_agorot: 0, shared_agorot: 0, overhead_agorot: 0, expense_agorot: 0, net_profit_agorot: 1, active_projects: 0, review_count: 0 } };
    }
    if (name === "list_categories") return { status: 200, json: [{ id: "c1" }] };
    if (name === "list_review") return { status: 200, json: [{ id: "r1", transaction_id: "11111111-1111-4000-8000-000000000001", description: "אלפא" }] };
    if (name === "get_transaction") return { status: 200, json: { id: "11111111-1111-4000-8000-000000000001", description: "אלפא" } };
    return { status: 500, json: null };
  });
  const projects = await callTool("list_projects", {}, ["read"], rpc);
  const categories = await callTool("list_categories", {}, ["read"], rpc);
  const review = await callTool("list_review", {}, ["read"], rpc);
  const expense = await callTool("get_expense", { transaction_id: "11111111-1111-4000-8000-000000000001" }, ["read"], rpc);
  const pending = await callTool("search_expenses", { scope: "pending" }, ["read"], rpc);
  const totals = await callTool("get_totals", {}, ["read"], rpc);
  assertEquals(projects.isError, false);
  assertEquals(categories.isError, false);
  assertEquals(review.isError, false);
  assertEquals(expense.isError, false);
  assertEquals(pending.isError, false);
  assertEquals(totals.isError, false);
  assertEquals(calls.map((call) => call.name), [
    "get_dashboard",
    "list_categories",
    "list_review",
    "get_transaction",
    "list_review",
    "get_dashboard",
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
    supplier_name: "מנופי",
    doc_date: "2026-09-15",
  };
  const dashboard = {
    company_id: "company-a",
    name: "א",
    basis: "invoiced",
    projects: [{ id: "p1", name: "הרצל", status: "active", income_agorot: 1, direct_agorot: 0, shared_agorot: 0, profit_agorot: 1 }],
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
    supplier: "מנופי",
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
    const rows = (projects.structuredContent.data as { projects: { name: string }[] }).projects;
    assertEquals(rows[0]?.name, "הרצל");
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
    "assign_expenses",
    "set_expense_category",
    "create_project",
    "create_category",
    "sync_bank",
    "hide_category",
    "undo",
    "undo_batch",
  ]);
  for (const tool of toolsFor(["write"])) {
    assertEquals(tool.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  }
  assertEquals(toolsFor(["read", "write"]).map((tool) => tool.name), [
    "list_projects",
    "list_categories",
    "list_review",
    "get_expense",
    "search_expenses",
    "get_totals",
    "assign_expense",
    "assign_expenses",
    "set_expense_category",
    "create_project",
    "create_category",
    "sync_bank",
    "hide_category",
    "undo",
    "undo_batch",
  ]);
  assertEquals(toolsFor([]), []);
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
    callTool("split_expense", { idempotency_key: "k" }, ["write"], rpc),
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
  ];
  for (const pending of cases) {
    const result = await pending;
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
});
