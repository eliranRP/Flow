import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pnlFromDemo, type DemoData } from "./pnl.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

interface ExpectedProject {
  name: string;
  invoiced_income: number;
  cash_income: number;
  direct_costs: number;
  shared_alloc: number;
  gross_profit_invoiced: number;
  gross_profit_cash: number;
  profit_after_alloc_invoiced: number;
  profit_after_alloc_cash: number;
  open_receivable_gross: number;
}

interface ExpectedPnl {
  projects: Record<string, ExpectedProject>;
  company: {
    invoiced_income: number;
    cash_income: number;
    direct: number;
    shared: number;
    overhead: number;
    net_profit_invoiced: number;
    net_profit_cash: number;
    open_receivables_gross: number;
  };
  monthly_expenses_net: Record<string, number>;
}

const demo = JSON.parse(readFileSync(join(fixtures, "demo-data.json"), "utf8")) as DemoData;
const expected = JSON.parse(readFileSync(join(fixtures, "expected-pnl.json"), "utf8")) as ExpectedPnl;

describe("demo client Rule A", () => {
  const pnl = pnlFromDemo(demo);

  it("loads the 75 SUMIT documents", () => {
    expect(demo.documents).toHaveLength(75);
    expect(pnl.lines).toHaveLength(75);
    const expenses = pnl.lines.filter((line) => line.kind === "exp");
    expect(expenses).toHaveLength(45);
  });

  it("matches per-project P&L on invoiced and cash basis", () => {
    for (const [key, target] of Object.entries(expected.projects)) {
      const actual = pnl.projects[key];
      expect(actual, key).toBeDefined();
      expect(actual?.name).toBe(target.name);
      expect(actual?.invoicedIncome).toBe(target.invoiced_income);
      expect(actual?.cashIncome).toBe(target.cash_income);
      expect(actual?.directCosts).toBe(target.direct_costs);
      expect(actual?.sharedAlloc).toBe(target.shared_alloc);
      expect(actual?.grossProfitInvoiced).toBe(target.gross_profit_invoiced);
      expect(actual?.grossProfitCash).toBe(target.gross_profit_cash);
      expect(actual?.profitAfterAllocInvoiced).toBe(target.profit_after_alloc_invoiced);
      expect(actual?.profitAfterAllocCash).toBe(target.profit_after_alloc_cash);
      expect(actual?.openReceivableGross).toBe(target.open_receivable_gross);
    }
  });

  it("matches the company P&L, including net profit 37,700 / −76,300", () => {
    expect(pnl.company.invoicedIncome).toBe(expected.company.invoiced_income);
    expect(pnl.company.cashIncome).toBe(expected.company.cash_income);
    expect(pnl.company.direct).toBe(expected.company.direct);
    expect(pnl.company.shared).toBe(expected.company.shared);
    expect(pnl.company.overhead).toBe(expected.company.overhead);
    expect(pnl.company.netProfitInvoiced).toBe(expected.company.net_profit_invoiced);
    expect(pnl.company.netProfitCash).toBe(expected.company.net_profit_cash);
    expect(pnl.company.openReceivablesGross).toBe(expected.company.open_receivables_gross);
    expect(pnl.company.netProfitInvoiced).toBe(37700);
    expect(pnl.company.netProfitCash).toBe(-76300);
  });

  it("matches monthly expense nets", () => {
    expect(pnl.monthlyExpensesNet).toEqual(expected.monthly_expenses_net);
  });

  it("marks SUMIT expenses with no VAT split as assumed, and the insurer as exempt", () => {
    const insurance = pnl.lines.find((line) => line.key === "O-INS");
    expect(insurance?.vatStatus).toBe("derived");
    expect(insurance?.netAgorot).toBe(insurance?.grossAgorot);

    const materials = pnl.lines.find((line) => line.key === "M-EXP-1");
    expect(materials?.vatStatus).toBe("assumed");
    expect(materials?.netAgorot).toBe(-2_200_000n);
    expect(materials?.grossAgorot).toBe(-2_596_000n);
  });
});
