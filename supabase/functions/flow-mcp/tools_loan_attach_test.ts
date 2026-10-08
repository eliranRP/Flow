// Flow MCP tools tests: attach_loan_payment (schedule parts, installments, fees, exact parts, demand loans).
import { assertEquals } from "jsr:@std/assert@1";
import { allocateLoanSplit, scheduleRowForDate } from "../../../packages/shared/src/loan-split.ts";
import { buildLoanSchedule, contractualPaymentMinor } from "../../../packages/shared/src/loan-schedule.ts";
import { callTool } from "./tools.ts";
import { CATEGORY, DEMAND_LOAN, feesRpc, INCOME_CATEGORY, LOAN, LOAN_TXN, paidRow, type Rpc, rpcOf } from "./tools_test_support.ts";

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
