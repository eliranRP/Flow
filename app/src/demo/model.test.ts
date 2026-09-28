import { wholeShekels } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { demoDashboard, demoUnpaid } from "./model";

describe("Flow Test preview", () => {
  it("matches the golden company to the whole shekel", () => {
    const invoiced = demoDashboard(null, null, "invoiced");
    const cash = demoDashboard(null, null, "cash");
    expect(wholeShekels(invoiced.net_profit_agorot)).toBe(37700);
    expect(wholeShekels(cash.net_profit_agorot)).toBe(-76300);
    expect(wholeShekels(invoiced.income_agorot)).toBe(472000);
    expect(wholeShekels(invoiced.expense_agorot)).toBe(434300);
    const techline = invoiced.projects.find((project) => project.name.includes("טק-ליין"));
    expect(wholeShekels(techline?.profit_agorot ?? 0n)).toBe(-29400);
    const gross = demoUnpaid().reduce((sum, row) => sum + row.open_gross_agorot, 0n);
    expect(wholeShekels(gross)).toBe(134520);
  });
});
