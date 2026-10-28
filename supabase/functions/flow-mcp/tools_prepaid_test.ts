// Flow MCP tools tests: prepaid amortization schedules (FLOW-155) and the books-closed date (FLOW-156).
// Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

const SCHEDULE = "a0000000-0000-4000-8000-0000000000c1";
const LINE = "a0000000-0000-4000-8000-0000000000c2";
const CATEGORY = "a0000000-0000-4000-8000-0000000000c3";
const PROJECT = "a0000000-0000-4000-8000-0000000000c4";
const ACCOUNT = "a0000000-0000-4000-8000-0000000000c5";

const OK = {
  status: 200,
  json: {
    ok: true,
    data: { schedule_id: SCHEDULE, undo_kind: "prepaid_create" },
  },
};
const WRITES = [
  "create_prepaid_schedule",
  "attach_prepaid_refund",
  "update_prepaid_schedule",
  "end_prepaid_schedule",
  "delete_prepaid_schedule",
  "set_books_closed_through",
];

function codeOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok
    ? null
    : result.structuredContent.error.code;
}

const CREATE = {
  idempotency_key: "pre-1",
  transaction_id: LINE,
  expense_category_id: CATEGORY,
  start_month: "2026-01",
  months: 12,
};

Deno.test("create_prepaid_schedule forwards every argument, defaults the optional ones to null", async () => {
  const { calls, rpc } = rpcOf(() => OK);
  const full = {
    ...CREATE,
    project_id: PROJECT,
    amount_minor: 262100,
    day_of_month: 28,
    prepaid_account_id: ACCOUNT,
    description: "Example Insurance Co, Maple house",
  };
  assertEquals(
    (await callTool("create_prepaid_schedule", full, ["write"], rpc)).isError,
    false,
  );
  assertEquals(calls.at(-1), {
    name: "mcp_create_prepaid_schedule",
    body: {
      p_idempotency_key: "pre-1",
      p_transaction_id: LINE,
      p_expense_category_id: CATEGORY,
      p_start_month: "2026-01",
      p_months: 12,
      p_project_id: PROJECT,
      p_amount_minor: 262100,
      p_day_of_month: 28,
      p_prepaid_account_id: ACCOUNT,
      p_description: "Example Insurance Co, Maple house",
    },
  });
  await callTool("create_prepaid_schedule", CREATE, ["write"], rpc);
  assertEquals(calls.at(-1)?.body, {
    p_idempotency_key: "pre-1",
    p_transaction_id: LINE,
    p_expense_category_id: CATEGORY,
    p_start_month: "2026-01",
    p_months: 12,
    p_project_id: null,
    p_amount_minor: null,
    p_day_of_month: null,
    p_prepaid_account_id: null,
    p_description: null,
  });
});

Deno.test("create_prepaid_schedule refuses a bad call before the database", async () => {
  const { calls, rpc } = rpcOf(() => OK);
  const bad: Record<string, unknown>[] = [
    { idempotency_key: "" },
    { transaction_id: "nope" },
    { expense_category_id: undefined },
    { start_month: "2026-13" },
    { start_month: "2026-00" },
    { start_month: "2026-1" },
    { start_month: "2026-01-01" },
    { months: 0 },
    { months: 121 },
    { months: 1.5 },
    { months: "12" },
    { amount_minor: 0 },
    { amount_minor: -5 },
    { amount_minor: 10.5 },
    { day_of_month: 0 },
    { day_of_month: 29 },
    { project_id: "nope" },
    { prepaid_account_id: "nope" },
    { description: "" },
    { extra: 1 },
  ];
  for (const change of bad) {
    assertEquals(
      codeOf(
        await callTool("create_prepaid_schedule", { ...CREATE, ...change }, [
          "write",
        ], rpc),
      ),
      "validation",
      JSON.stringify(change),
    );
  }
  assertEquals(calls.length, 0);
  for (const months of [1, 120]) {
    assertEquals(
      (await callTool("create_prepaid_schedule", { ...CREATE, months }, [
        "write",
      ], rpc)).isError,
      false,
    );
  }
});

Deno.test("the other prepaid writes forward their arguments", async () => {
  const { calls, rpc } = rpcOf(() => OK);
  await callTool(
    "attach_prepaid_refund",
    {
      idempotency_key: "k1",
      schedule_id: SCHEDULE,
      transaction_id: LINE,
      amount_minor: 139703,
    },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1), {
    name: "mcp_attach_prepaid_refund",
    body: {
      p_idempotency_key: "k1",
      p_schedule_id: SCHEDULE,
      p_transaction_id: LINE,
      p_amount_minor: 139703,
    },
  });
  await callTool(
    "attach_prepaid_refund",
    { idempotency_key: "k2", schedule_id: SCHEDULE, transaction_id: LINE },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1)?.body.p_amount_minor, null);
  await callTool(
    "update_prepaid_schedule",
    { idempotency_key: "k3", schedule_id: SCHEDULE, months: 24 },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1), {
    name: "mcp_update_prepaid_schedule",
    body: {
      p_idempotency_key: "k3",
      p_schedule_id: SCHEDULE,
      p_months: 24,
      p_expense_category_id: null,
      p_project_id: null,
    },
  });
  await callTool(
    "update_prepaid_schedule",
    {
      idempotency_key: "k4",
      schedule_id: SCHEDULE,
      expense_category_id: CATEGORY,
      project_id: PROJECT,
    },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1)?.body, {
    p_idempotency_key: "k4",
    p_schedule_id: SCHEDULE,
    p_months: null,
    p_expense_category_id: CATEGORY,
    p_project_id: PROJECT,
  });
  await callTool(
    "end_prepaid_schedule",
    {
      idempotency_key: "k5",
      schedule_id: SCHEDULE,
      from_month: "2026-07",
      remaining: "expense",
    },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1), {
    name: "mcp_end_prepaid_schedule",
    body: {
      p_idempotency_key: "k5",
      p_schedule_id: SCHEDULE,
      p_from_month: "2026-07",
      p_remaining: "expense",
    },
  });
  await callTool(
    "delete_prepaid_schedule",
    { idempotency_key: "k6", schedule_id: SCHEDULE },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1), {
    name: "mcp_delete_prepaid_schedule",
    body: { p_idempotency_key: "k6", p_schedule_id: SCHEDULE },
  });
  await callTool(
    "undo",
    { idempotency_key: "k7", kind: "prepaid_end", id: SCHEDULE },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1), {
    name: "mcp_undo",
    body: { p_idempotency_key: "k7", p_kind: "prepaid_end", p_id: SCHEDULE },
  });
  for (
    const kind of [
      "prepaid_create",
      "prepaid_update",
      "prepaid_refund",
      "prepaid_delete",
      "books_closed",
    ]
  ) {
    assertEquals(
      (await callTool(
        "undo",
        { idempotency_key: `u-${kind}`, kind, id: SCHEDULE },
        ["write"],
        rpc,
      )).isError,
      false,
      kind,
    );
    assertEquals(calls.at(-1)?.body.p_kind, kind);
  }
});

Deno.test("update, end, refund and delete refuse a bad call before the database", async () => {
  const { calls, rpc } = rpcOf(() => OK);
  const base = { idempotency_key: "bad", schedule_id: SCHEDULE };
  const cases: [string, Record<string, unknown>][] = [
    ["update_prepaid_schedule", base],
    ["update_prepaid_schedule", { ...base, months: 0 }],
    ["update_prepaid_schedule", { ...base, months: 121 }],
    ["update_prepaid_schedule", { ...base, project_id: null }],
    ["update_prepaid_schedule", { ...base, schedule_id: "nope", months: 3 }],
    ["end_prepaid_schedule", { ...base, from_month: "2026-07" }],
    ["end_prepaid_schedule", {
      ...base,
      from_month: "2026-7",
      remaining: "keep",
    }],
    ["end_prepaid_schedule", {
      ...base,
      from_month: "2026-13",
      remaining: "keep",
    }],
    ["end_prepaid_schedule", {
      ...base,
      from_month: "2026-07",
      remaining: "refund",
    }],
    ["attach_prepaid_refund", base],
    ["attach_prepaid_refund", {
      ...base,
      transaction_id: LINE,
      amount_minor: 0,
    }],
    ["attach_prepaid_refund", { ...base, transaction_id: "nope" }],
    ["delete_prepaid_schedule", { idempotency_key: "bad" }],
    ["delete_prepaid_schedule", { ...base, extra: true }],
  ];
  for (const [name, args] of cases) {
    assertEquals(
      codeOf(await callTool(name, args, ["write"], rpc)),
      "validation",
      `${name} ${JSON.stringify(args)}`,
    );
  }
  assertEquals(calls.length, 0);
});

Deno.test("set_books_closed_through takes a real date, or null to open the books", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: {
      ok: true,
      data: {
        books_closed_through: "2026-03-31",
        previous: null,
        undo_kind: "books_closed",
      },
    },
  }));
  await callTool(
    "set_books_closed_through",
    { idempotency_key: "bc-1", date: "2026-03-31" },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1), {
    name: "mcp_set_books_closed_through",
    body: { p_idempotency_key: "bc-1", p_date: "2026-03-31" },
  });
  await callTool(
    "set_books_closed_through",
    { idempotency_key: "bc-2", date: null },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1)?.body, { p_idempotency_key: "bc-2", p_date: null });
  const before = calls.length;
  for (
    const bad of [
      {},
      { date: "2026-02-30" },
      { date: "2026-3-1" },
      { date: 5 },
      { date: "2026-03" },
    ]
  ) {
    assertEquals(
      codeOf(
        await callTool(
          "set_books_closed_through",
          { idempotency_key: "bc-bad", ...bad },
          ["write"],
          rpc,
        ),
      ),
      "validation",
      JSON.stringify(bad),
    );
  }
  assertEquals(calls.length, before);
});

Deno.test("every prepaid write needs an idempotency key and a write scope", async () => {
  const { calls, rpc } = rpcOf(() => OK);
  const args: Record<string, Record<string, unknown>> = {
    create_prepaid_schedule: CREATE,
    attach_prepaid_refund: { schedule_id: SCHEDULE, transaction_id: LINE },
    update_prepaid_schedule: { schedule_id: SCHEDULE, months: 6 },
    end_prepaid_schedule: {
      schedule_id: SCHEDULE,
      from_month: "2026-07",
      remaining: "keep",
    },
    delete_prepaid_schedule: { schedule_id: SCHEDULE },
    set_books_closed_through: { date: "2026-03-31" },
  };
  for (const name of WRITES) {
    const { idempotency_key: _drop, ...rest } = {
      idempotency_key: "k",
      ...args[name],
    };
    assertEquals(
      codeOf(await callTool(name, rest, ["write"], rpc)),
      "validation",
      `${name} without a key`,
    );
    assertEquals(
      codeOf(
        await callTool(
          name,
          { idempotency_key: "k", ...args[name] },
          ["read"],
          rpc,
        ),
      ),
      "forbidden",
      `${name} read-only`,
    );
    assertEquals(
      (await callTool(
        name,
        { idempotency_key: "k", ...args[name] },
        ["write"],
        rpc,
      )).isError,
      false,
      name,
    );
  }
  assertEquals(calls.length, WRITES.length);
  const names = toolsFor(["write"]).map((tool) => tool.name);
  const readOnly = toolsFor(["read"]).map((tool) => tool.name);
  for (const name of WRITES) {
    assertEquals(names.includes(name), true, name);
    assertEquals(readOnly.includes(name), false, name);
  }
  for (const name of ["list_prepaid_schedules", "get_prepaid_schedule"]) {
    assertEquals(readOnly.includes(name), true, name);
  }
});

Deno.test("a refusal from the database comes back in words, and a failed call is refused", async () => {
  const words = "the books are closed through 2026-03-31";
  const refused = rpcOf(() => ({
    status: 200,
    json: { ok: false, error: { code: "refused", message: words } },
  }));
  assertEquals(
    (await callTool(
      "delete_prepaid_schedule",
      { idempotency_key: "r-1", schedule_id: SCHEDULE },
      ["write"],
      refused.rpc,
    )).structuredContent,
    {
      ok: false,
      error: { code: "refused", message: words },
    },
  );
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(
    codeOf(
      await callTool(
        "delete_prepaid_schedule",
        { idempotency_key: "r-2", schedule_id: SCHEDULE },
        ["write"],
        failed.rpc,
      ),
    ),
    "refused",
  );
  const shapeless = rpcOf(() => ({ status: 200, json: [] }));
  assertEquals(
    codeOf(
      await callTool(
        "set_books_closed_through",
        { idempotency_key: "r-3", date: null },
        ["write"],
        shapeless.rpc,
      ),
    ),
    "refused",
  );
});

Deno.test("list_prepaid_schedules and get_prepaid_schedule read for any scope with read", async () => {
  const list = {
    ok: true,
    data: { books_closed_through: null, schedules: [] },
  };
  const { calls, rpc } = rpcOf((name) => ({
    status: 200,
    json: name === "mcp_list_prepaid_schedules"
      ? list
      : { ok: true, data: { rows: [], refunds: [] } },
  }));
  const listed = await callTool("list_prepaid_schedules", {}, ["read"], rpc);
  assertEquals(listed.structuredContent, { ok: true, data: list.data });
  assertEquals(calls.at(-1), {
    name: "mcp_list_prepaid_schedules",
    body: { p_status: null },
  });
  await callTool("list_prepaid_schedules", { status: "ended" }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body, { p_status: "ended" });
  await callTool("get_prepaid_schedule", { id: SCHEDULE }, ["read"], rpc);
  assertEquals(calls.at(-1), {
    name: "mcp_get_prepaid_schedule",
    body: { p_schedule_id: SCHEDULE },
  });
  const before = calls.length;
  assertEquals(
    codeOf(
      await callTool(
        "list_prepaid_schedules",
        { status: "open" },
        ["read"],
        rpc,
      ),
    ),
    "validation",
  );
  assertEquals(
    codeOf(
      await callTool("list_prepaid_schedules", { extra: 1 }, ["read"], rpc),
    ),
    "validation",
  );
  assertEquals(
    codeOf(
      await callTool("get_prepaid_schedule", { id: "nope" }, ["read"], rpc),
    ),
    "validation",
  );
  assertEquals(
    codeOf(await callTool("get_prepaid_schedule", {}, ["read"], rpc)),
    "validation",
  );
  assertEquals(
    codeOf(
      await callTool("get_prepaid_schedule", { id: SCHEDULE }, ["write"], rpc),
    ),
    "forbidden",
  );
  assertEquals(calls.length, before);
  const gone = rpcOf(() => ({
    status: 200,
    json: { ok: false, error: { code: "not_found", message: "not found" } },
  }));
  assertEquals(
    codeOf(
      await callTool(
        "get_prepaid_schedule",
        { id: SCHEDULE },
        ["read"],
        gone.rpc,
      ),
    ),
    "not_found",
  );
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(
    codeOf(await callTool("list_prepaid_schedules", {}, ["read"], failed.rpc)),
    "refused",
  );
});
