// Flow MCP tools tests: read tools (searches, lists, project and totals reads). Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import {
  BATCH_KEY,
  CATEGORY,
  INCOME_CATEGORY,
  INCOME_TXN,
  JOB,
  LOAN,
  PROJECT,
  PROJECT_B,
  PROJECT_FIXTURE,
  REVIEW,
  rpcOf,
  TXN,
} from "./tools_test_support.ts";

const NO_META = {
  method: null,
  card_last4: null,
  memo: null,
  account: null,
  counterparty: null,
  bank_description: null,
};

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

  // An amount (FLOW-211): one figure in major units goes as both ends, in minor units.
  await callTool("search_expenses", { scope: "all", amount: "6,245.12" }, ["read"], rpc);
  const exact = calls.filter((call) => call.name === "search_transactions").at(-1)?.body;
  assertEquals([exact?.p_amount_min, exact?.p_amount_max], [624512, 624512]);
  await callTool("search_expenses", { scope: "pending", amount_min: 100 }, ["read"], rpc);
  const ranged = calls.filter((call) => call.name === "search_transactions").at(-1)?.body;
  assertEquals([ranged?.p_scope, ranged?.p_amount_min, "p_amount_max" in (ranged ?? {})], ["pending", 10000, false]);

  for (const bad of [
    { from: "2026-07-01", to: "2026-06-01" },
    { direction: "transfer" },
    { project_id: "alpha" },
    { category_id: "12" },
    { from: "06-01" },
    { amount: 5, amount_min: 1 },
    { amount: 0 },
    { amount_min: 5, amount_max: 4 },
    { amount_max: -1 },
    { amount_min: "abc" },
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
  const cashProjects = await callTool("list_projects", { basis: "cash" }, ["read"], rpc);
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
  const months = { basis: "invoiced", months: [{ month: "2026-09", by_currency: [{ currency: "ILS", income_minor: 100, expense_minor: 40, profit_minor: 60 }] }], by_currency: [] };
  const { calls, rpc } = rpcOf((name, body) => name !== "get_profit_months"
    ? { status: 500, json: null }
    : body.p_project_id === PROJECT_B ? { status: 200, json: null } : { status: 200, json: months });
  const company = await callTool("get_profit_months", { from: "2026-07-01", to: "2026-09-30" }, ["read"], rpc);
  assertEquals(company.isError, false);
  if (company.structuredContent.ok) assertEquals(company.structuredContent.data, months);
  const project = await callTool("get_profit_months", { project_id: PROJECT, basis: "cash" }, ["read"], rpc);
  assertEquals(project.isError, false);
  const missing = await callTool("get_profit_months", { project_id: PROJECT_B }, ["read"], rpc);
  assertEquals(missing.isError, true);
  if (!missing.structuredContent.ok) assertEquals(missing.structuredContent.error.code, "not_found");
  assertEquals(calls.map((call) => call.body), [
    { p_from: "2026-07-01", p_to: "2026-09-30", p_basis: "invoiced", p_project_id: null },
    { p_from: null, p_to: null, p_basis: "cash", p_project_id: PROJECT },
    { p_from: null, p_to: null, p_basis: "invoiced", p_project_id: PROJECT_B },
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
    // An extra or identity key is named (FLOW-414); the rest stay a bare validation.
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
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

Deno.test("get_project defaults to the company's basis, like list_projects and get_totals (FLOW-103)", async () => {
  const { calls, rpc } = rpcOf((name) => name === "get_project" || name === "get_dashboard"
    ? { status: 200, json: name === "get_project" ? PROJECT_FIXTURE : { projects: [], basis: "invoiced" } }
    : { status: 500, json: null });
  const project = await callTool("get_project", { id: PROJECT }, ["read"], rpc);
  const nullBasis = await callTool("get_project", { id: PROJECT, basis: null }, ["read"], rpc);
  await callTool("list_projects", {}, ["read"], rpc);
  assertEquals(project.isError, false);
  assertEquals(nullBasis.isError, false);
  assertEquals(calls[0], { name: "get_project", body: { p_id: PROJECT, p_basis: "invoiced" } });
  assertEquals(calls[1], { name: "get_project", body: { p_id: PROJECT, p_basis: "invoiced" } });
  assertEquals(calls[2]?.body.p_basis, calls[0]?.body.p_basis);
  if (project.structuredContent.ok) assertEquals((project.structuredContent.data as { basis: string }).basis, "invoiced");
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
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
});

Deno.test("get_project maps an RPC error to a read refusal and null to not found", async () => {
  for (const status of [400, 401, 403, 404, 500]) {
    const result = await callTool("get_project", { id: PROJECT, basis: "invoiced" }, ["read"], () => Promise.resolve({ status, json: { message: "permission denied" } }));
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) {
      assertEquals(result.structuredContent.error, { code: "refused", message: "The read was refused." });
    }
  }
  const missing = await callTool("get_project", { id: PROJECT, basis: "invoiced" }, ["read"], () => Promise.resolve({ status: 200, json: null }));
  assertEquals(missing.isError, true);
  if (!missing.structuredContent.ok) assertEquals(missing.structuredContent.error, { code: "not_found", message: "not found" });
  for (const json of [[PROJECT_FIXTURE], "x", 1]) {
    const odd = await callTool("get_project", { id: PROJECT, basis: "invoiced" }, ["read"], () => Promise.resolve({ status: 200, json }));
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
    body: { p_direction: "expense", p_from: null, p_to: null, p_group_by: "category", p_basis: "invoiced" },
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

Deno.test("list_unpaid returns minor units and open and marked totals per currency and direction", async () => {
  const rows = [
    { id: TXN, description: "Invoice 1", doc_date: "2026-06-01", currency: "ILS", direction: "income", project_name: "North", customer_name: "Client A", open_gross_agorot: 11800, open_net_agorot: 10000, marked_paid_at: null },
    { id: PROJECT, description: "Invoice 2", doc_date: "2026-06-02", currency: "ILS", direction: "income", project_name: null, customer_name: "Client B", open_gross_agorot: 5900, open_net_agorot: 5000, marked_paid_at: "2026-06-10T08:00:00+00:00", document_url: "https://pay.sumit.co.il/example/doc-2" },
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
    document_url: "https://pay.sumit.co.il/example/doc-2",
  });
  assertEquals(data.invoices[0].document_url, null);
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

Deno.test("list_review echoes an invoice's paired receipts (FLOW-309)", async () => {
  // The receipt joins its invoice's item: no card of its own, and paid / paid_on for "✓ שולם".
  const invoice = {
    id: "r1",
    transaction_id: INCOME_TXN,
    direction: "income",
    doc_kind: "invoice",
    description: "Example customer",
    receipts: [{ transaction_id: TXN, doc_date: "2026-10-12", amount_gross: 1180000, currency: "ILS" }],
    paid: true,
    paid_on: "2026-10-12",
  };
  const { rpc } = rpcOf((name) => {
    if (name === "list_review") return { status: 200, json: [invoice] };
    if (name === "get_line_meta") return { status: 200, json: [] };
    return { status: 500, json: null };
  });
  const listed = await callTool("list_review", {}, ["read"], rpc);
  assertEquals(listed.isError, false);
  if (!listed.structuredContent.ok) throw new Error("list_review failed");
  const rows = (listed.structuredContent.data as { reviews: Array<Record<string, unknown>> }).reviews;
  assertEquals(rows.length, 1);
  assertEquals(rows[0]?.receipts, invoice.receipts);
  assertEquals(rows[0]?.paid, true);
  assertEquals(rows[0]?.paid_on, "2026-10-12");
});

Deno.test("set_category_parent and create_category with a parent forward their input (FLOW-406)", async () => {
  const PARENT = "33333333-3333-4333-8333-333333333333";
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "category_parent", id: CATEGORY } } }));
  const set = await callTool("set_category_parent", { idempotency_key: "cp-1", category_id: CATEGORY, parent_id: PARENT.toUpperCase() }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_set_category_parent", body: { p_idempotency_key: "cp-1", p_category_id: CATEGORY, p_parent_id: PARENT } });
  await callTool("set_category_parent", { idempotency_key: "cp-2", category_id: CATEGORY, parent_id: null }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body.p_parent_id, null);
  await callTool("create_category", { idempotency_key: "cc-1", name: "Sewer", kind: "expense", parent_id: PARENT }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body.p_parent_id, PARENT);
  await callTool("create_category", { idempotency_key: "cc-2", name: "Sewer", kind: "expense" }, ["write"], rpc);
  assertEquals("p_parent_id" in (calls.at(-1)?.body ?? {}), false);
  const undo = await callTool("undo", { idempotency_key: "u-cp", kind: "category_parent", id: CATEGORY }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls.at(-1)?.body.p_kind, "category_parent");

  const before = calls.length;
  for (const input of [
    { idempotency_key: "k", category_id: CATEGORY },
    { idempotency_key: "k", category_id: "not-a-uuid", parent_id: null },
    { idempotency_key: "k", category_id: CATEGORY, parent_id: "nope" },
    { idempotency_key: "k", category_id: CATEGORY, parent_id: null, extra: 1 },
  ]) {
    const result = await callTool("set_category_parent", input, ["write"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);
});

Deno.test("get_breakdown level parent and search_expenses category_exact (FLOW-406)", async () => {
  const PARENT = "33333333-3333-4333-8333-333333333406";
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_breakdown") return { status: 200, json: { direction: "expense", totals: [], groups: [], excluded: [], review_count: 0 } };
    if (name === "mcp_company_loan_currency") return { status: 200, json: "ILS" };
    if (name === "get_line_meta") return { status: 200, json: [] };
    if (name === "search_transactions") return { status: 200, json: { total: 0, expenses: [] } };
    return { status: 200, json: { rows: [], has_more: false } };
  });
  await callTool("get_breakdown", { direction: "expense", level: "parent" }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body.p_group_by, "parent");
  await callTool("get_breakdown", { direction: "expense", level: "parent", group: PARENT }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body.p_group_by, "parent");
  await callTool("get_breakdown", { direction: "expense", level: "category" }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body.p_group_by, "category");

  await callTool("search_expenses", { scope: "filed", category_id: PARENT, category_exact: true }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body.p_category_exact, true);
  await callTool("search_expenses", { scope: "filed", category_id: PARENT }, ["read"], rpc);
  assertEquals("p_category_exact" in (calls.at(-1)?.body ?? {}), false);

  const before = calls.length;
  for (const [tool, input] of [
    ["get_breakdown", { direction: "expense", level: "parent", group_by: "project" }],
    ["get_breakdown", { direction: "expense", level: "sub" }],
    ["search_expenses", { scope: "filed", category_exact: true }],
    ["search_expenses", { scope: "filed", category_id: "none", category_exact: true }],
    ["search_expenses", { scope: "filed", category_id: PARENT, category_exact: "yes" }],
  ] as const) {
    const result = await callTool(tool, input, ["read"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);
});

Deno.test("get_expense on a split line moves the old shares to allocations_superseded", async () => {
  const id = "11111111-1111-4000-8000-000000000002";
  const share = { project_id: "p1", share: 100 };
  const part = { category_id: "c1", amount_minor: 500 };
  const { rpc } = rpcOf((name) => {
    if (name === "get_transaction") return { status: 200, json: { id, direction: "income", allocations: [share] } };
    if (name === "get_line_meta") return { status: 200, json: [] };
    if (name === "get_line_split") return { status: 200, json: { transaction_id: id, parts: [part] } };
    return { status: 500, json: null };
  });
  const split = await callTool("get_expense", { transaction_id: id }, ["read"], rpc);
  if (!split.structuredContent.ok) throw new Error("get_expense failed");
  const body = split.structuredContent.data as Record<string, unknown>;
  assertEquals(body.allocations, []);
  assertEquals(body.allocations_superseded, [share]);
  assertEquals(body.line_split, { parts: [part] });

  const { rpc: whole } = rpcOf((name) => {
    if (name === "get_transaction") return { status: 200, json: { id, direction: "income", allocations: [share] } };
    if (name === "get_line_meta") return { status: 200, json: [] };
    if (name === "get_line_split") return { status: 200, json: null };
    return { status: 500, json: null };
  });
  const read = await callTool("get_expense", { transaction_id: id }, ["read"], whole);
  if (!read.structuredContent.ok) throw new Error("get_expense failed");
  const unsplit = read.structuredContent.data as Record<string, unknown>;
  assertEquals(unsplit.allocations, [share]);
  assertEquals("allocations_superseded" in unsplit, false);
});
