// Flow MCP tools tests: projects, categories, company, invoices and Jev writes. Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { CATEGORY, CATEGORY_NEW, INCOME_CATEGORY, INCOME_TXN, LOAN, PROJECT, PROJECT_B, REVIEW, rpcOf, TXN } from "./tools_test_support.ts";

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

const PROJECT_NEW = "aaaaaaaa-aaaa-4000-8000-0000000000a1";

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
