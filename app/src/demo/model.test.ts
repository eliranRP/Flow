import { wholeShekels } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { demoDashboard, demoUnpaid } from "./model";

describe("Flow Test preview", () => {
  it("matches the golden company to the whole shekel", () => {
    const invoiced = demoDashboard(null, null, "invoiced");
    const cash = demoDashboard(null, null, "cash");
    expect(wholeShekels(BigInt(invoiced.net_profit_agorot))).toBe(37700);
    expect(wholeShekels(BigInt(cash.net_profit_agorot))).toBe(-76300);
    expect(wholeShekels(BigInt(invoiced.income_agorot))).toBe(472000);
    expect(wholeShekels(BigInt(invoiced.expense_agorot))).toBe(434300);
    const techline = invoiced.projects.find((project) => project.name.includes("טק-ליין"));
    expect(wholeShekels(BigInt(techline?.profit_agorot ?? 0))).toBe(-29400);
    const gross = demoUnpaid().reduce((sum, row) => sum + row.open_gross_agorot, 0);
    expect(wholeShekels(BigInt(gross))).toBe(134520);
  });
});
