import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { wholeShekels } from "./money.ts";
import { demoDataSchema, pnlFromDemo, type DemoData } from "./pnl.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const expectedProjectSchema = z.object({
  name: z.string(),
  invoiced_income: z.number(),
  cash_income: z.number(),
  direct_costs: z.number(),
  shared_alloc: z.number(),
  gross_profit_invoiced: z.number(),
  gross_profit_cash: z.number(),
  profit_after_alloc_invoiced: z.number(),
  profit_after_alloc_cash: z.number(),
  open_receivable_gross: z.number(),
});

const expectedPnlSchema = z.object({
  projects: z.record(z.string(), expectedProjectSchema),
  company: z.object({
    invoiced_income: z.number(),
    cash_income: z.number(),
    direct: z.number(),
    shared: z.number(),
    overhead: z.number(),
    net_profit_invoiced: z.number(),
    net_profit_cash: z.number(),
    open_receivables_gross: z.number(),
  }),
  monthly_expenses_net: z.record(z.string(), z.number()),
});

const demo = demoDataSchema.parse(
  JSON.parse(readFileSync(join(fixtures, "demo-data.json"), "utf8")),
);
const expected = expectedPnlSchema.parse(
  JSON.parse(readFileSync(join(fixtures, "expected-pnl.json"), "utf8")),
);

function shekels(agorot: bigint): number {
  return wholeShekels(agorot);
}

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
      expect(shekels(actual?.invoicedIncome ?? 0n)).toBe(target.invoiced_income);
      expect(shekels(actual?.cashIncome ?? 0n)).toBe(target.cash_income);
      expect(shekels(actual?.directCosts ?? 0n)).toBe(target.direct_costs);
      expect(shekels(actual?.sharedAlloc ?? 0n)).toBe(target.shared_alloc);
      expect(shekels(actual?.grossProfitInvoiced ?? 0n)).toBe(target.gross_profit_invoiced);
      expect(shekels(actual?.grossProfitCash ?? 0n)).toBe(target.gross_profit_cash);
      expect(shekels(actual?.profitAfterAllocInvoiced ?? 0n)).toBe(target.profit_after_alloc_invoiced);
      expect(shekels(actual?.profitAfterAllocCash ?? 0n)).toBe(target.profit_after_alloc_cash);
      expect(shekels(actual?.openReceivableGross ?? 0n)).toBe(target.open_receivable_gross);
    }
  });

  it("matches the company P&L, including net profit 37,700 / −76,300", () => {
    expect(shekels(pnl.company.invoicedIncome)).toBe(expected.company.invoiced_income);
    expect(shekels(pnl.company.cashIncome)).toBe(expected.company.cash_income);
    expect(shekels(pnl.company.direct)).toBe(expected.company.direct);
    expect(shekels(pnl.company.shared)).toBe(expected.company.shared);
    expect(shekels(pnl.company.overhead)).toBe(expected.company.overhead);
    expect(shekels(pnl.company.netProfitInvoiced)).toBe(expected.company.net_profit_invoiced);
    expect(shekels(pnl.company.netProfitCash)).toBe(expected.company.net_profit_cash);
    expect(shekels(pnl.company.openReceivablesGross)).toBe(expected.company.open_receivables_gross);
    expect(shekels(pnl.company.netProfitInvoiced)).toBe(37700);
    expect(shekels(pnl.company.netProfitCash)).toBe(-76300);
  });

  it("matches monthly expense nets", () => {
    const rounded: Record<string, number> = {};
    for (const [month, amount] of Object.entries(pnl.monthlyExpensesNet)) {
      rounded[month] = shekels(amount);
    }
    expect(rounded).toEqual(expected.monthly_expenses_net);
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

describe("non-exact VAT amounts", () => {
  it("rounds the net to agorot instead of throwing", () => {
    const odd: DemoData = {
      company: { name: "בדיקה", company_id: 1, vat_rate: 0.18 },
      projects: { p: { name: "פרויקט", budget_section_id: 1 } },
      customers: {},
      suppliers: {
        s: { name: "ספק", company_number: null, vat_able: true, sumit_id: 9 },
      },
      shared_alloc_worker_days: {},
      documents: [
        {
          sumit: {
            key: "ODD",
            sumit_id: 1,
            kind: "exp",
            date: "2026-04-01",
            gross: -10.01,
            wo: -10.01,
            vat: null,
            bud: 1,
            orig: null,
            cust: 9,
            cust_name: "ספק",
            number: null,
            desc: "חומר",
          },
        },
      ],
    };
    const pnl = pnlFromDemo(demoDataSchema.parse(odd));
    const line = pnl.lines[0];
    expect(line?.vatStatus).toBe("assumed");
    expect(line?.netAgorot).toBe(netExpected());
    expect(pnl.company.direct).toBe(-(line?.netAgorot ?? 0n));
  });
});

function netExpected(): bigint {
  return -848n;
}
