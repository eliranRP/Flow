// Flow MCP tools tests: loans (add, update, rates, list, schedule, delete and detach). Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { contractualPaymentMinor, regularPaymentMinor } from "../../../packages/shared/src/loan-schedule.ts";
import { callTool, toolsFor } from "./tools.ts";
import {
  CATEGORY,
  DEMAND_LOAN,
  feesRpc,
  LOAN,
  LOAN_TXN,
  paidRow,
  PROJECT,
  PROJECT_FIXTURE,
  rpcOf,
  TXN,
} from "./tools_test_support.ts";

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

Deno.test("set_loan_index takes a signed margin and null unlinks; set_index_rate forwards the index rate in ppm (FLOW-137)", async () => {
  const { calls, rpc } = rpcOf((name) => ({ status: 200, json: { ok: true, data: { undo_kind: name === "mcp_set_index_rate" ? "index_rate" : "loan_index" } } }));
  assertEquals((await callTool("set_loan_index", { idempotency_key: "i-1", loan_id: LOAN, rate_index: "il_prime", margin_percent: "0.75" }, ["write"], rpc)).isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_set_loan_index",
    body: { p_idempotency_key: "i-1", p_loan_id: LOAN, p_rate_index: "il_prime", p_margin_ppm: 7_500 },
  });
  await callTool("set_loan_index", { idempotency_key: "i-2", loan_id: LOAN, rate_index: "il_prime", margin_percent: -0.25 }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body.p_margin_ppm, -2_500);
  await callTool("set_loan_index", { idempotency_key: "i-3", loan_id: LOAN, rate_index: null, margin_percent: null }, ["write"], rpc);
  assertEquals([calls.at(-1)?.body.p_rate_index, calls.at(-1)?.body.p_margin_ppm], [null, null]);
  assertEquals((await callTool("set_index_rate", { idempotency_key: "p-1", rate_index: "il_prime", effective_date: "2027-01-01", annual_rate_percent: "6.25" }, ["write"], rpc)).isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_set_index_rate",
    body: { p_idempotency_key: "p-1", p_rate_index: "il_prime", p_effective_date: "2027-01-01", p_annual_rate_ppm: 62_500 },
  });
  await callTool("undo", { idempotency_key: "p-2", kind: "index_rate", id: CATEGORY }, ["write"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "p-2", p_kind: "index_rate", p_id: CATEGORY } });
  await callTool("undo", { idempotency_key: "i-4", kind: "loan_index", id: LOAN }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body.p_kind, "loan_index");
  const before = calls.length;
  for (const bad of [
    { rate_index: "us_prime", margin_percent: 1 },
    { rate_index: "il_prime", margin_percent: null },
    { rate_index: null, margin_percent: 1 },
    { rate_index: "il_prime", margin_percent: 101 },
    { rate_index: "il_prime", margin_percent: "-101" },
    { rate_index: "il_prime" },
  ]) {
    const refused = await callTool("set_loan_index", { idempotency_key: "i-bad", loan_id: LOAN, ...bad }, ["write"], rpc);
    assertEquals(refused.structuredContent, { ok: false, error: { code: "validation", message: "validation" } }, JSON.stringify(bad));
  }
  for (const bad of [
    { rate_index: "il_prime", effective_date: "2027-02-30", annual_rate_percent: 5 },
    { rate_index: "il_prime", effective_date: "2027-01-01", annual_rate_percent: -1 },
    { rate_index: "il_prime", effective_date: "2027-01-01", annual_rate_percent: null },
    { rate_index: "us_prime", effective_date: "2027-01-01", annual_rate_percent: 5 },
    { effective_date: "2027-01-01", annual_rate_percent: 5 },
  ]) {
    const refused = await callTool("set_index_rate", { idempotency_key: "p-bad", ...bad }, ["write"], rpc);
    assertEquals(refused.structuredContent, { ok: false, error: { code: "validation", message: "validation" } }, JSON.stringify(bad));
  }
  assertEquals(calls.length, before);
  for (const message of ["no loan linked to this index", "no linked loan is open on this date"]) {
    const db = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "refused", message } } }));
    const refused = await callTool("set_index_rate", { idempotency_key: "p-db", rate_index: "il_prime", effective_date: "2027-01-01", annual_rate_percent: 5 }, ["write"], db.rpc);
    assertEquals(refused.structuredContent, { ok: false, error: { code: "refused", message } });
  }
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

Deno.test("list_loans shows an open demand loan's accrued interest today, and null for other kinds (FLOW-211)", async () => {
  const payments = [
    paidRow("ffffffff-ffff-4000-8000-0000000000f1", { interestMinor: 30_000n, principalMinor: 1_000_000n }, { doc_date: "2026-01-31" }),
  ];
  const { rpc } = feesRpc(DEMAND_LOAN, 0, "2026-01-01", null, payments);
  const listed = await callTool("list_loans", {}, ["read"], rpc);
  const schedule = await callTool("get_loan_schedule", { loan_id: LOAN }, ["read"], rpc);
  if (!listed.structuredContent.ok || !schedule.structuredContent.ok) throw new Error("read failed");
  const loan = (listed.structuredContent.data as { loans: Array<Record<string, unknown>> }).loans[0];
  const accrued = (schedule.structuredContent.data as { accrued: { as_of: string; interest_minor: number } }).accrued;
  assertEquals([loan.accrued_interest_minor, loan.accrued_as_of], [accrued.interest_minor, accrued.as_of]);
  assertEquals((loan.accrued_interest_minor as number) > 0, true);

  for (const other of [{ ...DEMAND_LOAN, status: "closed" }, { ...DEMAND_LOAN, kind: "amortizing", term_months: 12, payment_minor: 433_000 }]) {
    const plain = feesRpc(other, 0, "2026-01-01", null, payments);
    const out = await callTool("list_loans", {}, ["read"], plain.rpc);
    if (!out.structuredContent.ok) throw new Error("read failed");
    const row = (out.structuredContent.data as { loans: Array<Record<string, unknown>> }).loans[0];
    assertEquals([row.accrued_interest_minor, row.accrued_as_of], [null, null]);
    assertEquals(plain.calls.some((call) => call.name === "mcp_loan_payments"), false);
  }

  // A failed payments read leaves the figure null; the list still reads.
  const broken = rpcOf((name) => name === "mcp_list_loans" ? { status: 200, json: [DEMAND_LOAN] } : { status: 500, json: null });
  const partial = await callTool("list_loans", {}, ["read"], broken.rpc);
  if (!partial.structuredContent.ok) throw new Error("read failed");
  assertEquals((partial.structuredContent.data as { loans: Array<Record<string, unknown>> }).loans[0].accrued_interest_minor, null);
});

Deno.test("loan kind tools are described", () => {
  const write = toolsFor(["write"]);
  const read = toolsFor(["read"]);
  const spec = (list: ReturnType<typeof toolsFor>, name: string) => list.find((tool) => tool.name === name);
  assertEquals(Object.keys(spec(write, "set_loan_rate")?.inputSchema.properties ?? {}), ["idempotency_key", "loan_id", "effective_date", "annual_rate_percent"]);
  for (const words of ["rate before the loan start", "undo is kind loan_rate", "recasts the payment"]) {
    assertEquals(spec(write, "set_loan_rate")?.description.includes(words), true, words);
  }
  assertEquals(Object.keys(spec(write, "set_loan_index")?.inputSchema.properties ?? {}), ["idempotency_key", "loan_id", "rate_index", "margin_percent"]);
  assertEquals(Object.keys(spec(write, "set_index_rate")?.inputSchema.properties ?? {}), ["idempotency_key", "rate_index", "effective_date", "annual_rate_percent"]);
  for (const words of ["undo is kind index_rate", "all or nothing", "no loan linked to this index"]) {
    assertEquals(spec(write, "set_index_rate")?.description.includes(words), true, words);
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
