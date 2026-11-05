// FLOW-1032 (decision 0254): a loan payment Jev filed under a loan category is split onto its loan.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { JEV_MODEL } from "./jev.ts";
import { tagWork } from "./jev_tag.ts";
import { loanFromRow, loanSplit, matchLoan, planLoanFill, type TagLoan } from "./jev_tag_loan.ts";
import { company, COMPANY, expense, EXPENSE, memoryStore, PROJECT, projects } from "./jev_tag_test_support.ts";

const MORTGAGE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECOND = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INTEREST = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PLAIN = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** 120,000.00 at 6 percent over 360 months, 100.00 escrow: 819.46 a month. */
function loanRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MORTGAGE,
    currency: "USD",
    kind: "amortizing",
    status: "open",
    closed_on: null,
    principal_minor: 12000000,
    annual_rate_ppm: 60000,
    term_months: 360,
    start_date: "2026-01-01",
    payment_minor: 81946,
    escrow_minor: 10000,
    interest_only_months: null,
    amortization_months: null,
    balance_minor: 12000000,
    rates: [],
    last_payment_minor: null,
    ...overrides,
  };
}

function loan(overrides: Record<string, unknown> = {}): TagLoan {
  const parsed = loanFromRow(loanRow(overrides));
  assert(parsed);
  return parsed;
}

const line = { amountMinor: 81946n, currency: "USD", docDate: "2026-01-03" };

Deno.test("loanFromRow reads a candidate row and refuses one it cannot use", () => {
  assertEquals(loan().paymentMinor, 81946n);
  assertEquals(loan({ last_payment_minor: 83000 }).lastPaymentMinor, 83000n);
  assertEquals(loanFromRow(loanRow({ kind: "demand" })), null);
  assertEquals(loanFromRow(loanRow({ term_months: null })), null);
  assertEquals(loanFromRow(loanRow({ payment_minor: 819.46 })), null);
  assertEquals(loanFromRow(null), null);
});

Deno.test("matchLoan takes the one loan whose payment is the line", () => {
  assertEquals(matchLoan(line, [loan(), loan({ id: SECOND, payment_minor: 50000 })])?.id, MORTGAGE);
  // Two loans with the same payment: not sure, so none.
  assertEquals(matchLoan(line, [loan(), loan({ id: SECOND })]), null);
  // Another currency, a closed loan, a line before the loan, nothing left to pay.
  assertEquals(matchLoan({ ...line, currency: "ILS" }, [loan()]), null);
  assertEquals(matchLoan(line, [loan({ status: "closed", closed_on: "2025-12-31" })]), null);
  assertEquals(matchLoan({ ...line, docDate: "2025-12-15" }, [loan()]), null);
  assertEquals(matchLoan(line, [loan({ balance_minor: 0 })]), null);
  assertEquals(matchLoan({ ...line, amountMinor: 0n }, [loan()]), null);
});

Deno.test("matchLoan falls back to the loan's last payment, once its payment no longer matches", () => {
  // Escrow went up: the bank now takes 830.00, as last month.
  const raised = { ...line, amountMinor: 83000n };
  assertEquals(matchLoan(raised, [loan({ last_payment_minor: 83000 }), loan({ id: SECOND, payment_minor: 50000 })])?.id, MORTGAGE);
  assertEquals(matchLoan(raised, [loan({ last_payment_minor: 83000 }), loan({ id: SECOND, last_payment_minor: 83000 })]), null);
  // A payment match wins over another loan's last payment.
  assertEquals(matchLoan(line, [loan({ id: SECOND, last_payment_minor: 81946, payment_minor: 50000 }), loan()])?.id, MORTGAGE);
  assertEquals(matchLoan(raised, [loan()]), null);
});

Deno.test("loanSplit is the schedule row for the date, principal taking the difference", () => {
  const parts = loanSplit(line, loan());
  assert(parts);
  assertEquals(parts.map((part) => [part.part, part.amountMinor]), [
    ["interest", 60000n],
    ["escrow", 10000n],
    ["principal", 11946n],
  ]);
  const raised = loanSplit({ ...line, amountMinor: 83000n }, loan());
  assertEquals(raised?.map((part) => part.amountMinor), [60000n, 10000n, 13000n]);
  assertEquals(raised?.map((part) => part.scheduledMinor), [60000n, 10000n, 11946n]);
  // The principal may not pass the balance.
  assertEquals(loanSplit(line, loan({ balance_minor: 100 })), null);
  assertEquals(planLoanFill(line, [loan()])?.loanId, MORTGAGE);
  assertEquals(planLoanFill(line, []), null);
});

function loanAnswers(categoryConfidence: number) {
  return {
    project: { type: "choice", choice: PROJECT, confidence: 0.5, probabilities: null },
    category: { type: "choice", choice: INTEREST, confidence: categoryConfidence, probabilities: null },
  };
}

const loanCategories = [{ id: INTEREST, name: "Interest", loanPart: "interest" }, { id: PLAIN, name: "Materials" }];

function loanLine(overrides: Parameters<typeof expense>[0] = {}) {
  return expense({ amountGross: -81946, amountNet: -81946, vatAmount: 0, amountOriginal: 81946, currency: "USD", docDate: "2026-01-03", ...overrides });
}

Deno.test("auto splits a loan payment Jev filed under a loan category, and never fills that category", async () => {
  const store = memoryStore();
  const report = await tagWork(
    [company({ categories: loanCategories, loans: [loan()], expenses: [loanLine()] })],
    store,
    () => Promise.resolve({ model: JEV_MODEL, answers: loanAnswers(0.97), usage: null }),
    "jev-test-key",
  );
  assertEquals(report.prefilled, 1);
  assertEquals(store.writes.length, 0, "no whole-line category, and the project was below the threshold");
  assertEquals(store.loanWrites.length, 1);
  assertEquals(store.loanWrites[0].companyId, COMPANY);
  assertEquals(store.loanWrites[0].transactionId, EXPENSE);
  assertEquals(store.loanWrites[0].loanId, MORTGAGE);
  assertEquals(store.loanWrites[0].confidence, 0.97);
  assertEquals(store.loanWrites[0].parts.map((part) => part.amountMinor), [60000n, 10000n, 11946n]);
});

Deno.test("a loan category below the threshold, in shadow, on a set line, or with no loan writes nothing", async () => {
  const call = (confidence: number) => () =>
    Promise.resolve({ model: JEV_MODEL, answers: loanAnswers(confidence), usage: null });
  const cases: Array<[string, Parameters<typeof company>[0], number]> = [
    ["below the threshold", { expenses: [loanLine()] }, 0.8],
    ["shadow", { mode: "shadow", expenses: [loanLine()] }, 0.97],
    ["owner set the category", { expenses: [loanLine({ categoryAssigned: true })] }, 0.97],
    ["no loan matches", { expenses: [loanLine({ amountOriginal: 70000, amountGross: -70000 })] }, 0.97],
    ["a refund", { expenses: [loanLine({ amountGross: 81946 })] }, 0.97],
  ];
  for (const [name, overrides, confidence] of cases) {
    const store = memoryStore();
    const report = await tagWork(
      [company({ categories: loanCategories, loans: [loan()], projects, ...overrides })],
      store,
      call(confidence),
      "jev-test-key",
    );
    assertEquals(store.loanWrites.length, 0, name);
    assertEquals(store.writes.length, 0, name);
    assertEquals(report.prefilled, 0, name);
    assertEquals(report.tagged, 1, name);
  }
});
