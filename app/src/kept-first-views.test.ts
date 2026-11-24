import { cashLinesSchema, cashToDaySchema, categoryRowSchema, loanOutlooksSchema, projectCategoryMonthsSchema, weeklySummarySchema } from "@flow/shared";
import { QueryClient } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushKeptReads, keepReadsOf, resetKeptReadsForTests, restoreKeptReads } from "./kept-reads";
import { KEPT_PROJECT_LINES } from "./kept-rules";
import { idbKeptStore, type KeptStore } from "./kept-store";
import { resetShownCompanyForTests, setShownCompany } from "./lib/company-header";
import { utilityPayersSchema } from "./utility-refund-schema";

/** FLOW-1292: each read of a screen's first view that is kept (Home, the project page, Profit's next month). */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let store: KeptStore;

const line = {
  transaction_id: "t1", part: null, description: "חשבון", supplier_name: null, project_name: null, category_name: null,
  doc_date: "2026-11-02", cash_month_date: "2026-11-01", currency: "ILS", amount_minor: 1200, side: "out",
};
const linesPage = cashLinesSchema.parse({ rows: [line], has_more: true });
const projectLines = { counted: cashLinesSchema.parse({ rows: [line], has_more: false })?.rows ?? [], kept: [], more: false };
const weekly = weeklySummarySchema.parse({
  week_start: "2026-11-15", currency: "ILS", lines: 4, auto_approved: 2, week_waiting: 1, waiting: 3, in_minor: 5000, out_minor: 2000,
  profit_minor: 3000, kept_out_minor: 0, prev_profit_minor: null, alert: null, more_over_budget: 0,
});
const categoryMonths = projectCategoryMonthsSchema.parse({
  project_id: "p1", today: "2026-11-23", this_month: "2026-11", months: ["2026-10"],
  categories: [{ id: "c1", name: "חשמל", group_name: null, currency: "ILS", this_month_minor: 100, months_minor: [90], months_seen: 1, expected_minor: 95, typical_day: 5, flag: null }],
});
const payers = utilityPayersSchema.parse({
  project_id: "p1",
  utilities: [{ supplier_id: "s1", supplier_name: "חברת חשמל", currency: "ILS", payer: "tenant", added: true, found: true, usual_minor: 4500, bill_count: 2, last_bill_date: "2026-10-30", category_id: null, category_name: null }],
});
const categories = categoryRowSchema.array().parse([{ id: "c1", name: "חשמל", kind: "expense", hidden: false, is_default: true }]);
const edits = [{ id: "e1", kind: "change", row_key: "k", category_id: null, direction: "expense", amount_minor: 100, pace: "month", start_month: "2026-12" }];
const inputs = { month: "2026-12", overhead_project_id: null, projects: [], general: [], edits: [] };
const loans = [{ id: "l1", currency: "ILS", balanceMinor: 900n, principalMinor: 1000n, rates: [], categoryIds: {} }];
const forecastItem = { key: "party:expense:s1:ILS", direction: "expense", kind: "recurring", name: "חשמל", currency: "ILS", usual: 20000n, minor: 20000n, day: 5, description: null, due_on: null, moved_out: false, overridden: false, expected_on: null, late_days: 0, category_id: null, project_id: null, project_name: null, pace: "month", line_start: null };
const forecast = { month: "2026-11", base: "ILS", overrides: [], build: { items: [forecastItem], income: [], expense: [forecastItem], moved: [], small: [], incomeTotal: 0n, expenseTotal: 20000n, changed: 0 } };

const loanOutlooks = loanOutlooksSchema.parse([
  { loan_id: "l1", next: { due_date: "2026-12-01", interest_minor: 16000, escrow_minor: 0, principal_minor: 44000, amount_minor: 60000 }, ahead_minor: 720000, to_end_minor: 5000000, end_date: "2034-11-01", late_on: "2026-11-01" },
  { loan_id: "l2", late_on: "2026-11-01" },
]);
const loanRows = { rows: [{ id: "l1", name: "הלוואה", currency: "ILS", balanceMinor: 900n, flaggedParts: 0, projectId: null, projectName: null }], loans: [] };

// FLOW-1308: company_forecast's 'totals' as Profit's card holds it (bigint amounts, counts, the income facts).
const facts = { rows: 2, recurring: 2, rent: 1, name: null };
const forecastMonth = { month: "2026-12", incomeMinor: 300000n, expenseMinor: 120000n, netMinor: 180000n, cashOnlyMinor: 0n, projects: 2, general: true, income: facts };
const companyTotals = { today: "2026-11-24", currency: "ILS", months: [forecastMonth], income: facts };

type Case = { name: string; key: unknown[]; good: unknown; bad: unknown; preview: unknown[] };
const CASES: Case[] = [
  { name: "transfer match count", key: ["transfer-match-count", "off"], good: 3, bad: -1, preview: ["transfer-match-count", "empty"] },
  { name: "utility refund count", key: ["utility-refund-count", "off"], good: { notRefunded: 2, totals: [{ currency: "ILS", minor: 12300n }] }, bad: { notRefunded: 2, totals: [{ currency: "ILS" }] }, preview: ["utility-refund-count", "empty"] },
  { name: "cash to day", key: ["dashboard", "cash-to-day", "off", "2026-10", 23], good: cashToDaySchema.parse([{ currency: "ILS", in_minor: 1000, out_minor: 500 }]), bad: [{ currency: "ILS" }], preview: ["dashboard", "cash-to-day", "empty", "2026-10", 23] },
  { name: "weekly summary", key: ["dashboard", "weekly-summary", "2026-11-15"], good: weekly, bad: { ...weekly, lines: "4" }, preview: ["dashboard", "weekly-summary", null] },
  { name: "home cash lines", key: ["breakdown-lines", "cash", "off", "2026-11", "out", "ILS", null, 20], good: { pages: [linesPage], pageParams: [0] }, bad: { pages: [{ rows: [{ ...line, doc_date: undefined }], has_more: true }], pageParams: [0] }, preview: ["breakdown-lines", "cash", "empty", "2026-11", "out", "ILS", null, 20] },
  { name: "project month lines", key: ["breakdown-lines", "project-cash-month", "off", "p1", "2026-11", ""], good: projectLines, bad: { ...projectLines, counted: [{ transaction_id: "t1" }] }, preview: ["breakdown-lines", "project-cash-month", "empty", "p1", "2026-11", ""] },
  { name: "utility payers", key: ["utility-payers", "off", "p1"], good: payers, bad: [{ supplier_id: "s1", payer: "nobody", currency: "ILS", bill_count: 1, usual_minor: null }], preview: ["utility-payers", "empty", "p1"] },
  { name: "project category months", key: ["project", "category-months", "off", "p1", "2026-11-23"], good: categoryMonths, bad: { ...categoryMonths, categories: "none" }, preview: ["project", "category-months", "empty", "p1", "2026-11-23"] },
  { name: "project forecast edits", key: ["project-forecast-edits", "off", "p1", "2026-12"], good: edits, bad: [{ id: "e1" }], preview: ["project-forecast-edits", "empty", "p1", "2026-12"] },
  { name: "categories", key: ["categories", "off"], good: categories, bad: [{ id: "c1", name: "חשמל", kind: "other" }], preview: ["categories", "empty"] },
  { name: "company next month inputs", key: ["project-forecast-edits", "off", "company", "2026-11-23", false], good: inputs, bad: { month: "2026-12" }, preview: ["project-forecast-edits", "empty", "company", "2026-11-23", false] },
  // FLOW-1316: the Loans list's rows (no next payment, late date or rate: a list kept before that has them and is not used) and its outlooks.
  { name: "loan list", key: ["loans", COMPANY, "list"], good: loanRows, bad: { ...loanRows, rows: [{ ...loanRows.rows[0], ratePpm: 50000 }] }, preview: ["loans", COMPANY] },
  { name: "loan outlooks", key: ["loans", COMPANY, "outlooks", "2026-11-24"], good: loanOutlooks, bad: [{ loan_id: "l1", next: { due_date: "2026-12-01" } }], preview: ["loans", COMPANY, "outlooks"] },
  { name: "company forecast loans", key: ["loans", "company-forecast", "off"], good: loans, bad: [{ id: "l1", currency: "EUR", balanceMinor: 1n, rates: [] }], preview: ["loans", "company-forecast", "empty"] },
  { name: "company forecast totals, the card's month (FLOW-1308)", key: ["month-forecast", "off", "company", "totals", "2026-11-24", "2026-12"], good: companyTotals, bad: { ...companyTotals, months: [{ ...forecastMonth, incomeMinor: 300000.5 }] }, preview: ["month-forecast", "empty", "company", "totals", "2026-11-24", "2026-12"] },
  { name: "company forecast totals, the year view's months (FLOW-1308)", key: ["month-forecast", "off", "company", "totals", "2026-11-24", "2026-12,2027-01"], good: { ...companyTotals, months: [forecastMonth, { ...forecastMonth, month: "2027-01" }] }, bad: { ...companyTotals, income: { rows: 2 } }, preview: ["month-forecast", "empty", "company", "totals", "2026-11-24", "2026-12,2027-01"] },
  { name: "month forecast (FLOW-1314)", key: ["month-forecast", "off", "answer", "2026-11"], good: forecast, bad: { ...forecast, build: { ...forecast.build, expenseTotal: 20000.5 } }, preview: ["month-forecast", "empty", "answer", "2026-11"] },
];

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function read(client: QueryClient, key: readonly unknown[], data: unknown): Promise<void> {
  await client.query({ queryKey: key, queryFn: () => Promise.resolve(data), staleTime: 0 });
}

beforeEach(() => {
  const factory = new IDBFactory();
  store = idbKeptStore(() => factory);
  resetKeptReadsForTests(store);
  resetShownCompanyForTests();
  setShownCompany(USER, COMPANY);
});

afterEach(() => {
  resetKeptReadsForTests();
  resetShownCompanyForTests();
});

describe("the first views' kept reads (FLOW-1292)", () => {
  it.each(CASES)("$name: kept and put back, and a malformed row is dropped", async ({ key, good, bad }) => {
    const first = newClient();
    keepReadsOf(first);
    await read(first, key, good);
    await flushKeptReads();
    expect((await store.all()).map((item) => item.key)).toEqual([JSON.stringify(key)]);
    const next = newClient();
    await restoreKeptReads(next);
    expect(next.getQueryData(key)).toEqual(good);
    expect(next.getQueryState(key)?.isInvalidated).toBe(true);
    // The same key with data that does not fit its read.
    const [saved] = await store.all();
    if (saved == null) throw new Error("nothing kept");
    await store.put([{ ...saved, data: bad }]);
    const broken = newClient();
    await restoreKeptReads(broken);
    expect(broken.getQueryData(key)).toBeUndefined();
    expect(await store.all()).toEqual([]);
  });

  it.each(CASES)("$name: a preview's key is not kept", async ({ preview, good }) => {
    const client = newClient();
    keepReadsOf(client);
    await read(client, preview, good);
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("keeps Home's first page of lines only, and not the 200-line read", async () => {
    const client = newClient();
    keepReadsOf(client);
    const twoPages = { pages: [linesPage, linesPage], pageParams: [0, 20] };
    await read(client, ["breakdown-lines", "cash", "off", "2026-11", "out", "ILS", null, 20], twoPages);
    await read(client, ["breakdown-lines", "cash", "off", "2026-11", "out", "ILS", null, 200], { pages: [linesPage], pageParams: [0] });
    await read(client, ["breakdown-lines", "cash", "off", "2026-11", "out", "ILS", "p1", 20], { pages: [linesPage], pageParams: [0] });
    await read(client, ["breakdown-lines", "cash", "off", "2026-11", "kept", "ILS", null, 20], { pages: [linesPage], pageParams: [0] });
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("does not keep a project month of more than KEPT_PROJECT_LINES lines", async () => {
    const client = newClient();
    keepReadsOf(client);
    const many = Array.from({ length: KEPT_PROJECT_LINES + 1 }, () => projectLines.counted[0]);
    await read(client, ["breakdown-lines", "project-cash-month", "off", "p1", "2026-11", ""], { ...projectLines, counted: many });
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("keeps Profit's slim next-month answer, not the full one with the rest of the year", async () => {
    const client = newClient();
    keepReadsOf(client);
    await read(client, ["project-forecast-edits", "off", "company", "2026-11-23", true], inputs);
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("does not keep a month's company forecast rows (FLOW-1308): over 100 KB, and not a first view", async () => {
    const client = newClient();
    keepReadsOf(client);
    await read(client, ["month-forecast", "off", "company", "rows", "2026-11-24", "2026-12"], { ...companyTotals, forecast: {} });
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("never keeps a null answer (a project with no category months)", async () => {
    const client = newClient();
    keepReadsOf(client);
    await client.query({ queryKey: ["project", "category-months", "off", "p1", "2026-11-23"], queryFn: () => Promise.resolve(null) });
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("keeps a company's loan list of two loans by their shape, with no schema (the rule checks the shape alone)", async () => {
    const first = newClient();
    keepReadsOf(first);
    await read(first, ["loans", "company-forecast", "off"], [...loans, { ...loans[0], id: "l2" }]);
    await flushKeptReads();
    const next = newClient();
    await restoreKeptReads(next);
    expect(next.getQueryData(["loans", "company-forecast", "off"])).toHaveLength(2);
  });
});

describe("a failed read (FLOW-1267's review nit)", () => {
  it("clears the owner a read began for, so a hand-written copy beside a failed read is not kept", async () => {
    const client = newClient();
    keepReadsOf(client);
    await client.query({ queryKey: ["review", "off"], queryFn: () => Promise.reject(new Error("offline")) }).catch(() => undefined);
    client.setQueryData(["review-meta", "off", ""], { total: 1, loaded: 1, next: null, failed: false, loading: false });
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });
});
