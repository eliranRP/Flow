import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readForecastLoans } from "./project-next-month-query";

// readForecastLoans: the loans and their balances are asked for at once (FLOW-1171), and a balance joins its loan.

const db: { requested: string[]; answers: Record<string, unknown[]>; gate: Promise<void> | undefined } = vi.hoisted(() => ({
  requested: [],
  answers: {},
  gate: undefined,
}));

const supabase = vi.hoisted(() => ({
  from: (table: string) => {
    db.requested.push(table);
    const keep: Array<(row: Record<string, unknown>) => boolean> = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        keep.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        keep.push((row) => values.includes(row[column]));
        return builder;
      },
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
        const rows = (db.answers[table] ?? []).filter((row) => keep.every((test) => test(row as Record<string, unknown>)));
        return (db.gate ?? Promise.resolve()).then(() => ({ data: rows, error: null })).then(onFulfilled, onRejected);
      },
    };
    return builder;
  },
}));

vi.mock("./lib/supabase", () => ({ getSupabase: () => supabase }));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const loanRow = (id: string, projectId: string | null) => ({
  id,
  company_id: "c1",
  name: `הלוואה ${id}`,
  currency: "ILS",
  principal_minor: 5_000_000,
  annual_rate_ppm: 50_000,
  term_months: 120,
  start_date: "2026-01-01",
  payment_minor: null,
  escrow_minor: 0,
  kind: "amortizing",
  interest_only_months: null,
  amortization_months: null,
  status: "open",
  closed_on: null,
  refinanced_into_id: null,
  closing_paid_minor: null,
  project_id: projectId,
  interest_category_id: null,
  escrow_category_id: null,
  principal_category_id: null,
  fees_category_id: null,
  loan_rates: [],
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  db.requested = [];
  db.gate = undefined;
  db.answers = {
    loans: [loanRow("l1", "p1"), loanRow("l2", null)],
    loan_balances: [{ loan_id: "l1", balance_minor: 4_000_000, flagged_parts: 2, currency: "ILS" }],
  };
});

afterEach(() => {
  db.gate = undefined;
});

describe("readForecastLoans (FLOW-1171)", () => {
  it("sends the loans and the balances together, before either answers", async () => {
    let release: () => void = () => undefined;
    db.gate = new Promise<void>((resolve) => { release = resolve; });
    const read = readForecastLoans(null);
    await tick();
    expect([...db.requested].sort()).toEqual(["loan_balances", "loans"]);
    release();
    await read;
  });

  it("joins each balance to its loan, and keeps a loan with no balance row", async () => {
    const loans = await readForecastLoans(null);
    expect(loans.map((loan) => loan.id)).toEqual(["l1", "l2"]);
    expect(loans[0]?.balanceMinor).toBe(4_000_000n);
    expect(typeof loans[1]?.balanceMinor).toBe("bigint");
  });

  it("returns only the project's loans, with their own balances, when a project id is passed", async () => {
    const loans = await readForecastLoans("p1");
    expect(loans.map((loan) => [loan.id, loan.projectId, loan.balanceMinor])).toEqual([["l1", "p1", 4_000_000n]]);
  });

  it("returns nothing when no loan is filed under the project", async () => {
    expect(await readForecastLoans("p9")).toEqual([]);
  });
});
