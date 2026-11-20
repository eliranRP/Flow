import { beforeEach, describe, expect, it, vi } from "vitest";
import { readForecastLoans } from "./project-next-month-query";
import { type LoanDetailDbRow, readLoanRow } from "./screens/loan-detail-data";

// FLOW-1209: the company-wide read sends the loans and the loan balances together. A fake client logs a request when
// it is sent (the query is awaited) and answers only once the test opens the gate, so the test can see what is in
// flight before either answer comes back. Invented rows only.
const db = vi.hoisted((): { sent: string[]; answers: Record<string, { data: unknown; error: unknown }>; gate: Promise<void> } => ({
  sent: [],
  answers: {},
  gate: Promise.resolve(),
}));

vi.mock("./ready-client", () => ({
  readyClient: () => Promise.resolve({
    from: (table: string) => {
      const ops: string[] = [];
      const query = {
        select: (columns: string) => {
          ops.push(`select(${columns})`);
          return query;
        },
        eq: (column: string, value: string) => {
          ops.push(`eq(${column}, ${value})`);
          return query;
        },
        in: (column: string, values: string[]) => {
          ops.push(`in(${column}, ${values.join(",")})`);
          return query;
        },
        then: (onOk: (value: unknown) => unknown, onErr?: (reason: unknown) => unknown) => {
          db.sent.push([table, ...ops].join(" "));
          return db.gate.then(() => db.answers[table]).then(onOk, onErr);
        },
      };
      return query;
    },
  }),
}));

function loan(id: string, projectId: string): LoanDetailDbRow {
  return {
    id,
    company_id: "company-1",
    name: `Loan ${id}`,
    currency: "ILS",
    principal_minor: 100000,
    annual_rate_ppm: 45000,
    term_months: 120,
    start_date: "2020-01-01",
    payment_minor: 1200,
    escrow_minor: 50,
    kind: "amortizing",
    interest_only_months: null,
    amortization_months: 120,
    status: "open",
    closed_on: null,
    project_id: projectId,
    interest_category_id: null,
    escrow_category_id: null,
    principal_category_id: null,
    fees_category_id: null,
    loan_rates: [],
  } as unknown as LoanDetailDbRow;
}

const LOAN_B = loan("loan-b", "project-1");
const LOAN_A = loan("loan-a", "project-1");
const LOANS = [LOAN_B, LOAN_A];
// loan-a has no balance row; loan-x has one, but the loans read does not return loan-x.
const BALANCES = [
  { loan_id: "loan-b", balance_minor: 81234, flagged_parts: 1 },
  { loan_id: "loan-x", balance_minor: 999999, flagged_parts: 0 },
];

/** What the read gives for LOANS and BALANCES: each loan of the loans read, in its order, with its own balance row. */
function expected() {
  return [
    readLoanRow(LOAN_B, { balanceMinor: BigInt(81234), flaggedParts: 1 }),
    readLoanRow(LOAN_A, null),
  ];
}

/** Lets every request that is going to be sent go out. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let openGate: () => void = () => {};

beforeEach(() => {
  db.sent.length = 0;
  db.answers = {
    loans: { data: LOANS, error: null },
    loan_balances: { data: BALANCES, error: null },
  };
  db.gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
});

describe("the forecast's loans for the company (FLOW-1209)", () => {
  it("sends the loans and the loan balances before either answers, and gives the same loans", async () => {
    const result = readForecastLoans();
    await settle();

    expect(db.sent).toHaveLength(2);
    expect(db.sent[0]).toMatch(/^loans select\(/);
    expect(db.sent[1]).toMatch(/^loan_balances select\(loan_id, balance_minor, flagged_parts\)$/);

    openGate();
    await expect(result).resolves.toEqual(expected());
  });

  it("a balance row of a loan the loans read did not return does not change the result", async () => {
    const result = readForecastLoans();
    openGate();
    const loans = await result;

    expect(loans.map((row) => row.id)).toEqual(["loan-b", "loan-a"]);
    expect(loans).toEqual(expected());
  });

  it("gives no loans when the company has none", async () => {
    db.answers.loans = { data: [], error: null };
    const result = readForecastLoans();
    openGate();
    await expect(result).resolves.toEqual([]);
  });

  it("throws the loans error when the loans read fails", async () => {
    db.answers.loans = { data: null, error: { message: "loans down" } };
    const result = readForecastLoans();
    openGate();
    await expect(result).rejects.toEqual({ message: "loans down" });
  });
});
