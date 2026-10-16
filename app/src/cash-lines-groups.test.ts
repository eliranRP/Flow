import type { CashCurrencyRow, CashLine } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { cashSummaryRows, notInProfitMinor } from "./cash";
import { groupLines, lineDayTitle, lineInitials, linesOrder, linesSummary } from "./cash-lines-groups";

const TODAY = "2026-10-11";

// Invented lines on יצא (the server sends each row positive on its own side).
function line(overrides: Partial<CashLine> & Pick<CashLine, "transaction_id" | "amount_minor">): CashLine {
  return {
    part: null,
    description: "ACH DEBIT SAMPLE CO 000",
    supplier_name: "סטודיו גל",
    project_name: "דירת הגפן",
    category_name: "חומרים",
    doc_date: "2026-10-09",
    cash_month_date: "2026-10-09",
    currency: "ILS",
    side: "out",
    source: "manual",
    ...overrides,
  };
}

const rows: CashLine[] = [
  line({ transaction_id: "a", amount_minor: 120_000n, cash_month_date: "2026-10-11", project_name: "דירת הגפן", category_name: "חומרים" }),
  line({ transaction_id: "b", amount_minor: 45_000n, cash_month_date: "2026-10-10", project_name: null, category_name: "חומרים", supplier_name: "אור חשמל" }),
  line({ transaction_id: "c", amount_minor: 300_000n, cash_month_date: "2026-10-10", project_name: "בית הים", category_name: "שיפוץ", supplier_name: "מים ושות׳", pending: true, in_pnl: false }),
  line({ transaction_id: "d", amount_minor: 45_000n, cash_month_date: "2026-10-02", project_name: "דירת הגפן", category_name: null, supplier_name: "אור חשמל" }),
];

describe("linesOrder", () => {
  it("reads the URL order and defaults to date", () => {
    expect(linesOrder("amount")).toBe("amount");
    expect(linesOrder("project")).toBe("project");
    expect(linesOrder("category")).toBe("category");
    expect(linesOrder("nope")).toBe("date");
    expect(linesOrder(null)).toBe("date");
  });
});

describe("lineDayTitle", () => {
  it("names today and yesterday, and dates older days without a year", () => {
    expect(lineDayTitle("2026-10-11", TODAY)).toBe("היום · 11/10");
    expect(lineDayTitle("2026-10-10", TODAY)).toBe("אתמול · 10/10");
    expect(lineDayTitle("2026-10-02", TODAY)).toBe("02/10");
  });
});

describe("groupLines by date", () => {
  const groups = groupLines(rows, "date", "out", TODAY);

  it("makes one group per day, newest first, with the day's sum", () => {
    expect(groups.map((g) => g.title)).toEqual(["היום · 11/10", "אתמול · 10/10", "02/10"]);
    expect(groups.map((g) => g.total)).toEqual([120_000n, 345_000n, 45_000n]);
  });

  it("adds up to the page total", () => {
    const total = groups.reduce((sum, g) => sum + (g.total ?? 0n), 0n);
    expect(total).toBe(linesSummary(rows, "out").total);
  });
});

describe("groupLines by amount", () => {
  it("is one group, rows largest first, with no sum", () => {
    const [only] = groupLines(rows, "amount", "out", TODAY);
    expect(only?.title).toBe("מהגדול לקטן");
    expect(only?.total).toBeNull();
    expect(only?.rows.map((r) => r.transaction_id)).toEqual(["c", "a", "b", "d"]);
  });

  it("breaks an amount tie by date, newest first", () => {
    const [only] = groupLines(rows, "amount", "out", TODAY);
    expect(only?.rows.map((r) => r.transaction_id).slice(2)).toEqual(["b", "d"]);
  });
});

describe("groupLines by project and category", () => {
  it("groups by project, largest total first, with בלי פרויקט for no project", () => {
    const groups = groupLines(rows, "project", "out", TODAY);
    expect(groups.map((g) => [g.title, g.total])).toEqual([
      ["בית הים", 300_000n],
      ["דירת הגפן", 165_000n],
      ["בלי פרויקט", 45_000n],
    ]);
  });

  it("groups by category, with בלי קטגוריה for no category", () => {
    const groups = groupLines(rows, "category", "out", TODAY);
    expect(groups.map((g) => g.title)).toEqual(["שיפוץ", "חומרים", "בלי קטגוריה"]);
    expect(groups.reduce((sum, g) => sum + (g.total ?? 0n), 0n)).toBe(linesSummary(rows, "out").total);
  });
});

describe("linesSummary", () => {
  it("counts the lines and the pending ones, and sums what profit leaves out", () => {
    expect(linesSummary(rows, "out")).toEqual({ total: 510_000n, count: 4, pending: 1, notInProfit: 300_000n });
  });

  it("has nothing pending or out of profit when no line has those flags", () => {
    expect(linesSummary([rows[0] as CashLine], "out")).toEqual({ total: 120_000n, count: 1, pending: 0, notInProfit: 0n });
  });
});

describe("the page total against Home's row", () => {
  it("equals the same side's figure in the month's cash summary", () => {
    const month: CashCurrencyRow = {
      currency: "ILS",
      in_minor: 0n,
      out_minor: 510_000n,
      net_minor: -510_000n,
      profit_minor: -210_000n,
      excluded_count: 0,
      excluded_in_minor: 0,
      excluded_out_minor: 0,
    } as unknown as CashCurrencyRow;
    const home = cashSummaryRows("2026-10", [month], "").find((row) => row.id === "out");
    expect(home?.amounts[0]?.minor).toBe(linesSummary(rows, "out").total);
    expect(notInProfitMinor(month)).toBeDefined();
  });
});

describe("lineInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(lineInitials("סטודיו גל")).toBe("סג");
    expect(lineInitials("מים ושות׳")).toBe("מו");
  });

  it("takes the first two letters of a one-word name, uppercased for Latin", () => {
    expect(lineInitials("אור")).toBe("או");
    expect(lineInitials("acme")).toBe("AC");
  });

  it("is ? with no name", () => {
    expect(lineInitials(null)).toBe("?");
    expect(lineInitials("   ")).toBe("?");
  });
});
