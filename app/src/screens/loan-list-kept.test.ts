import { QueryClient } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushKeptReads, KEPT_MAX_BYTES, keepReadsOf, resetKeptReadsForTests, restoreKeptReads } from "../kept-reads";
import { idbKeptStore, type KeptStore } from "../kept-store";
import { resetShownCompanyForTests, setShownCompany } from "../lib/company-header";
import { readLoanRow } from "./loan-detail-data";
import { type LoanListData, nextPaymentOf, readLoanList } from "./loan-list";
import { loanListSummary } from "./loan-list-summary";
import { latePayment, loanOutlook } from "./loan-outlook";

/** FLOW-1296: the kept loan list holds no schedules, and a restored list draws the Loans figures a fresh one does. */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TODAY = "2026-11-22";
const KEY = ["loans", COMPANY, "list"];

let answers: Record<string, unknown[]> = {};
const query = (table: string) => {
  const next = {
    select: () => next,
    eq: () => next,
    order: () => Promise.resolve({ data: answers[table] ?? [], error: null }),
    then: (ok: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: answers[table] ?? [], error: null }).then(ok),
  };
  return next;
};
vi.mock("../lib/supabase", () => ({ getSupabase: () => ({ from: (table: string) => query(table) }) }));

/** About 20 open loans of 30 years (360 months), a closed one and a demand one, invented. */
function loanRow(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `l${String(n)}`, company_id: COMPANY, name: `הלוואה ${String(n)}`, currency: "ILS", principal_minor: 40_000_000 + n * 1_000_000,
    annual_rate_ppm: 40_000, term_months: 360, start_date: "2024-06-01", payment_minor: Math.round((40_000_000 + n * 1_000_000) * 0.004774), escrow_minor: 0,
    kind: "amortizing", interest_only_months: null, amortization_months: null, status: "open", closed_on: null, project_id: null,
    interest_category_id: null, escrow_category_id: null, principal_category_id: null, fees_category_id: null, loan_rates: [],
    created_at: "2024-05-20T08:00:00Z", ...over,
  };
}

const BALANCES = Array.from({ length: 20 }, (_, i) => ({ loan_id: `l${String(i + 1)}`, balance_minor: 39_000_000 + (i + 1) * 900_000, flagged_parts: 0, last_paid_on: i % 4 === 0 ? "2026-09-05" : "2026-11-05" }));

let store: KeptStore;

beforeEach(() => {
  store = idbKeptStore(() => new IDBFactory());
  resetKeptReadsForTests(store);
  resetShownCompanyForTests();
  setShownCompany(USER, COMPANY);
  answers = {
    loans: [
      ...Array.from({ length: 20 }, (_, i) => loanRow(i + 1)),
      loanRow(21, { kind: "demand", term_months: null, payment_minor: null }),
      loanRow(22, { status: "closed", closed_on: "2026-01-01" }),
    ],
    loan_balances: BALANCES,
    projects: [],
    loan_unsplit_payments: [],
  };
});

afterEach(() => {
  resetKeptReadsForTests();
  resetShownCompanyForTests();
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const text = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item));

/** What the summary card draws from a list: its select, as loan-summary-entries.ts runs it. */
function summaryOf(data: LoanListData) {
  return loanListSummary(data.loans.map(({ row, balance, schedule }) => {
    const loan = readLoanRow(row, balance);
    return { loan, outlook: loanOutlook(loan, TODAY, schedule) };
  }), "ILS");
}

async function keptAndRestored(): Promise<{ fresh: LoanListData; restored: LoanListData; size: number }> {
  const fresh = await readLoanList(COMPANY, TODAY);
  const first = newClient();
  keepReadsOf(first);
  await first.query({ queryKey: KEY, queryFn: () => Promise.resolve(fresh), staleTime: 0 });
  await flushKeptReads();
  const [saved] = await store.all();
  const next = newClient();
  await restoreKeptReads(next);
  const restored = next.getQueryData<LoanListData>(KEY);
  if (restored == null || saved == null) throw new Error("nothing kept");
  return { fresh, restored, size: saved.size };
}

describe("the kept loan list (FLOW-1296)", () => {
  it("is kept without any loan's schedule, and far smaller", async () => {
    const { fresh, restored, size } = await keptAndRestored();
    const months = fresh.loans.reduce((sum, loan) => sum + (loan.schedule?.length ?? 0), 0);
    expect(months).toBeGreaterThan(7000);
    expect(restored.loans).toHaveLength(22);
    expect(restored.loans.every((loan) => !("schedule" in loan))).toBe(true);
    const whole = new TextEncoder().encode(text(fresh)).length;
    // The numbers the PR reports.
    console.info(`loan list kept row: full ${String(whole)} bytes, kept ${String(size)} bytes, ${String(months)} schedule months`);
    expect(whole).toBeGreaterThan(1_000_000);
    expect(size).toBeLessThan(120_000);
    expect(size).toBeLessThan(KEPT_MAX_BYTES / 40);
  });

  it("draws the Loans figures a fresh list draws: the rows, and the summary built from the loans", async () => {
    const { fresh, restored } = await keptAndRestored();
    expect(restored.rows).toEqual(fresh.rows);
    expect(restored.rows.filter((row) => row.lateOn != null).length).toBeGreaterThan(0);
    const summary = summaryOf(restored);
    expect(summary).toEqual(summaryOf(fresh));
    expect(summary.openCount).toBe(21);
    expect(summary.monthlyMinor > 0n).toBe(true);
  });

  it("gives the same next payment and late date from the restored loans as from the fresh list", async () => {
    const { fresh, restored } = await keptAndRestored();
    for (const row of fresh.rows) {
      const kept = restored.loans.find((loan) => loan.row.id === row.id);
      if (kept == null) throw new Error("loan missing");
      const loan = readLoanRow(kept.row, kept.balance);
      expect(nextPaymentOf(loan, TODAY) ?? undefined).toEqual(row.next);
      const lastPaidOn = BALANCES.find((item) => item.loan_id === row.id)?.last_paid_on ?? null;
      expect(latePayment(loan, { lastPaidOn, addedOn: "2024-05-20" }, TODAY) ?? undefined).toEqual(row.lateOn);
    }
  });

  it("drops a row whose rows or loans are malformed", async () => {
    const { size } = await keptAndRestored();
    const [saved] = await store.all();
    if (saved == null) throw new Error("nothing kept");
    expect(saved.size).toBe(size);
    for (const data of [{ rows: [{ name: "x" }], loans: [] }, { rows: [], loans: "none" }, "x"]) {
      await store.put([{ ...saved, data }]);
      const broken = newClient();
      await restoreKeptReads(broken);
      expect(broken.getQueryData(KEY)).toBeUndefined();
      expect(await store.all()).toEqual([]);
      await store.put([saved]);
    }
  });
});
