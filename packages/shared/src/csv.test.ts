import { describe, expect, it } from "vitest";
import { ledgerToCsv } from "./csv";

describe("accountant csv", () => {
  it("writes hebrew headers, shekels, and a BOM", () => {
    const csv = ledgerToCsv([
      {
        doc_date: "2026-09-01",
        direction: "expense",
        description: 'מלט, "שק"',
        project_name: null,
        category_name: "חומרים",
        amount_net: -10000,
        vat_amount: -1800,
        amount_gross: -11800,
      },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("תאריך,סוג,תיאור");
    expect(csv).toContain("01/09/2026,הוצאה,\"מלט, \"\"שק\"\"\",,חומרים,-100.00,-18.00,-118.00");
  });
});
