// Flow MCP tools tests: line writes (assign, split, P&L switches, batches), scopes, refusals and sync_bank.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import {
  BATCH_KEY,
  CATEGORY,
  INCOME_CATEGORY,
  JOB,
  PROJECT,
  PROJECT_B,
  REVIEW,
  type Rpc,
  rpcOf,
  TXN,
} from "./tools_test_support.ts";

Deno.test("a read failure does not say the write was refused", async () => {
  const { rpc } = rpcOf(() => ({ status: 500, json: null }));
  const result = await callTool("list_categories", {}, ["read"], rpc);
  assertEquals(result.isError, true);
  if (!result.structuredContent.ok) {
    assertEquals(result.structuredContent.error.message.includes("write was refused"), false);
    assertEquals(result.structuredContent.error.message, "The read was refused.");
  }
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
    "invite_member",
    "set_member_role",
    "remove_member",
    "add_loan",
    "update_loan",
    "attach_loan_payment",
    "set_loan_rate",
    "set_loan_index",
    "set_index_rate",
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
    "set_category_parent",
    "set_category_group",
    "create_project_group",
    "set_project_group",
    "set_jev_mode",
    "set_category_cash",
    "set_line_cash",
    "set_lines_cash",
    "set_cash_basis",
    "set_line_recurring",
    "set_line_pace",
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
    "list_project_groups",
    "get_project_group",
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
    "get_project_cash_months",
    "get_project_cash_lines",
    "get_cash_months",
    "get_cash_years",
    "get_cash_lines",
    "match_lines",
    "get_anomalies",
    "get_jev_suggestions",
    "get_missing_bills",
    "get_expected_months",
    "get_recurring_changes",
    "get_line_recurring",
    "get_line_charges",
    "get_recurring_this_month",
    "list_unpaid",
    "list_team",
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
    "invite_member",
    "set_member_role",
    "remove_member",
    "add_loan",
    "update_loan",
    "attach_loan_payment",
    "set_loan_rate",
    "set_loan_index",
    "set_index_rate",
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
    "set_category_parent",
    "set_category_group",
    "create_project_group",
    "set_project_group",
    "set_jev_mode",
    "set_category_cash",
    "set_line_cash",
    "set_lines_cash",
    "set_cash_basis",
    "set_line_recurring",
    "set_line_pace",
    "undo_jev_prefill",
    "undo",
    "undo_batch",
  ]);
  assertEquals(toolsFor([]), []);
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

Deno.test("assign_expense_split passes exact amount shares to the RPC (FLOW-346)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const result = await callTool("assign_expense_split", {
    idempotency_key: "split-exact",
    transaction_id: TXN,
    shares: [{ project_id: PROJECT, amount_minor: 800000 }, { project_id: PROJECT_B, amount_minor: 2066316 }],
  }, ["write"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].body.p_shares, [
    { project_id: PROJECT, amount_minor: 800000 },
    { project_id: PROJECT_B, amount_minor: 2066316 },
  ]);
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
      // FLOW-346: amount shares are whole cents above zero, one kind per call, never both keys.
      [{ project_id: PROJECT, amount_minor: 100 }, { project_id: PROJECT_B, share: 50 }],
      [{ project_id: PROJECT, amount_minor: 100, share: 50 }, { project_id: PROJECT_B, amount_minor: 100 }],
      [{ project_id: PROJECT, amount_minor: 0 }, { project_id: PROJECT_B, amount_minor: 100 }],
      [{ project_id: PROJECT, amount_minor: 1.5 }, { project_id: PROJECT_B, amount_minor: 100 }],
      [{ project_id: PROJECT }, { project_id: PROJECT_B, amount_minor: 100 }],
      [{ project_id: PROJECT, amount_minor: 100 }, { project_id: PROJECT.toUpperCase(), amount_minor: 100 }],
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
      properties: { project_id: { type: "string" }, share: { type: "integer" }, amount_minor: { type: "integer" } },
      required: ["project_id"],
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
