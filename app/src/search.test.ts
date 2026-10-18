import type { SearchPage, SearchRow } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { allTime, customRange, presetPeriod } from "./period";
import {
  EMPTY_FILTERS,
  SEARCH_MAX_LENGTH,
  SEARCH_PAGE,
  filterSearchRows,
  hasChipFilters,
  mergeSearchPages,
  readSearchFilters,
  searchAmountRange,
  searchArgs,
  searchCountWords,
  searchFiltersQuery,
  searchMonthTitle,
  searchMonthTotals,
  searchRowAmount,
  searchRowTitle,
  searchTotalText,
  uniqueSearchRows,
} from "./search";

// Invented lines only.
function row(id: string, patch: Partial<SearchRow> = {}): SearchRow {
  return {
    id,
    description: "תנועה",
    doc_date: "2026-09-10",
    doc_kind: null,
    amount_net: -10_000n,
    vat_agorot: null,
    direction: "expense",
    currency: "ILS",
    amount_original: null,
    line_status: null,
    project_id: null,
    category_id: null,
    project_name: null,
    category_name: null,
    supplier_name: null,
    customer_name: null,
    waiting_review: false,
    kept_out: false,
    split_parts: 0,
    loan_matched: false,
    ...patch,
  };
}

const NOW = new Date("2026-10-08T09:00:00Z");

describe("search filters in the URL", () => {
  it("reads nothing as every line", () => {
    expect(readSearchFilters(new URLSearchParams(""), NOW)).toEqual(EMPTY_FILTERS);
    expect(hasChipFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("round-trips every filter and keeps preview", () => {
    const filters = {
      q: "חומרי",
      direction: "expense" as const,
      project: "4c3a2b1e-0000-4000-8000-000000000001",
      category: "none",
      period: presetPeriod("months3", NOW),
      review: true,
    };
    const query = searchFiltersQuery(filters, new URLSearchParams("preview=1"), NOW);
    expect(query).toContain("preview=1");
    const back = readSearchFilters(new URLSearchParams(query.slice(1)), NOW);
    expect(back).toEqual(filters);
    expect(hasChipFilters(back)).toBe(true);
  });

  it("drops a broken value instead of sending it", () => {
    const filters = readSearchFilters(new URLSearchParams("dir=sideways&project=a%20b&category=%3Cx%3E&period=custom&from=2026-10-01&to=2026-09-01&review=yes"), NOW);
    expect(filters).toEqual(EMPTY_FILTERS);
  });

  it("takes only a uuid or none for a live read, and short ids for sample lists", () => {
    // The server refuses any other id (0140); a hand-edited link would fail every retry.
    expect(readSearchFilters(new URLSearchParams("project=p1&category=abc"), NOW).project).toBeNull();
    expect(readSearchFilters(new URLSearchParams("project=p1&category=abc"), NOW).category).toBeNull();
    expect(readSearchFilters(new URLSearchParams("project=p1"), NOW, { ids: "any" }).project).toBe("p1");
    expect(readSearchFilters(new URLSearchParams("project=none&category=none"), NOW)).toMatchObject({ project: "none", category: "none" });
  });

  it("drops a custom range with a day that does not exist", () => {
    // The shape passes, but the server's ::date cast would fail.
    expect(readSearchFilters(new URLSearchParams("period=custom&from=2026-02-31&to=2026-03-05"), NOW).period).toEqual(allTime());
    expect(readSearchFilters(new URLSearchParams("period=custom&from=2026-02-01&to=2026-02-28"), NOW).period).toEqual(customRange("2026-02-01", "2026-02-28"));
  });

  it("cuts a long text at the server's length", () => {
    const filters = readSearchFilters(new URLSearchParams({ q: "א".repeat(SEARCH_MAX_LENGTH + 20) }), NOW);
    expect(filters.q).toHaveLength(SEARCH_MAX_LENGTH);
  });

  it("writes no period for all time", () => {
    expect(searchFiltersQuery({ ...EMPTY_FILTERS, period: allTime() })).toBe("");
  });
});

describe("searchArgs", () => {
  it("sends only what is set, the pending scope for review, and the page", () => {
    expect(searchArgs(EMPTY_FILTERS, 0)).toEqual({ p_scope: "all", p_limit: SEARCH_PAGE, p_offset: 0 });
    expect(searchArgs({
      q: "  ספק  ",
      direction: "income",
      project: "none",
      category: "c-1",
      period: customRange("2026-09-01", "2026-09-30"),
      review: true,
    }, 50)).toEqual({
      p_scope: "pending",
      p_limit: SEARCH_PAGE,
      p_offset: 50,
      p_query: "ספק",
      p_from: "2026-09-01",
      p_to: "2026-09-30",
      p_project: "none",
      p_category: "c-1",
      p_direction: "income",
    });
  });

  it("sends no text when only spaces were typed", () => {
    expect(searchArgs({ ...EMPTY_FILTERS, q: "   " }, 0)).not.toHaveProperty("p_query");
  });
});

describe("searchAmountRange", () => {
  it("reads a whole number as its whole range of cents, and a decimal as its own cent or tenth", () => {
    expect(searchAmountRange("8940")).toEqual({ min: 894000n, max: 894099n });
    expect(searchAmountRange("8940.17")).toEqual({ min: 894017n, max: 894017n });
    expect(searchAmountRange("8940.1")).toEqual({ min: 894010n, max: 894019n });
  });

  it("ignores separators and a currency sign", () => {
    expect(searchAmountRange("8,940.17")).toEqual({ min: 894017n, max: 894017n });
    expect(searchAmountRange("$8940")).toEqual({ min: 894000n, max: 894099n });
    expect(searchAmountRange("₪ 8 940")).toEqual({ min: 894000n, max: 894099n });
  });

  it("is null for text that is not an amount", () => {
    expect(searchAmountRange("2024-inv")).toBeNull();
    expect(searchAmountRange("INV-8940")).toBeNull();
    expect(searchAmountRange("")).toBeNull();
  });
});

describe("searchArgs amount read", () => {
  it("sends the range and no text for the amount read, and the text for the text read", () => {
    const filters = { ...EMPTY_FILTERS, q: "8940" };
    const range = searchAmountRange("8940");
    expect(searchArgs(filters, 0, range)).toEqual({ p_scope: "all", p_limit: SEARCH_PAGE, p_offset: 0, p_amount_min: 894000, p_amount_max: 894099 });
    expect(searchArgs(filters, 0)).toMatchObject({ p_query: "8940" });
    expect(searchArgs(filters, 0)).not.toHaveProperty("p_amount_min");
  });
});

describe("mergeSearchPages", () => {
  const page = (expenses: SearchRow[], total: number): SearchPage => ({ total, expenses });

  it("merges the text and amount reads once per line, newest first, and resumes each read on its own offset", () => {
    const byText = page([row("a", { doc_date: "2026-10-01", description: "8940 ref" }), row("b", { doc_date: "2026-09-01" })], 3);
    const byAmount = page([row("b", { doc_date: "2026-09-01" }), row("c", { doc_date: "2026-10-05", amount_net: -894_017n })], 2);
    const merged = mergeSearchPages({ text: { page: byText, offset: 0 }, amount: { page: byAmount, offset: 0 } });
    expect(merged.expenses.map((line) => line.id)).toEqual(["c", "a", "b"]);
    expect(merged.total).toBe(5);
    // The text read has 3 lines and two are in hand; the amount read's two are all of its lines.
    expect(merged.next).toEqual({ text: 2, amount: null });
  });

  it("counts a line both reads find once in the total and the month totals", () => {
    // "8940" text: x (both) and a. Amount 8940.xx: x (both) and b. The overlap read finds x alone.
    const shared = row("x", { doc_date: "2026-10-03", amount_net: -894_017n });
    const byText = { total: 2, expenses: [shared, row("a", { doc_date: "2026-10-04", amount_net: -10_000n })], months: [{ month: "2026-10", currency: "ILS", income_minor: 0n, expense_minor: 904_017n }] } as SearchPage;
    const byAmount = { total: 2, expenses: [shared, row("b", { doc_date: "2026-10-05", amount_net: -894_017n })], months: [{ month: "2026-10", currency: "ILS", income_minor: 0n, expense_minor: 1_788_034n }] } as SearchPage;
    const both = { total: 1, expenses: [shared], months: [{ month: "2026-10", currency: "ILS", income_minor: 0n, expense_minor: 894_017n }] } as SearchPage;
    const merged = mergeSearchPages({ text: { page: byText, offset: 0 }, amount: { page: byAmount, offset: 0 }, both });
    expect(merged.expenses.map((line) => line.id)).toEqual(["b", "a", "x"]);
    expect(merged.total).toBe(3);
    expect(merged.months).toEqual([{ month: "2026-10", currency: "ILS", income_minor: 0n, expense_minor: 1_798_034n }]);
  });

  it("is done when neither read has lines left", () => {
    const merged = mergeSearchPages({ text: { page: page([row("a")], 1), offset: 0 } });
    expect(merged.next).toBeNull();
  });
});

describe("searchTotalText", () => {
  it("signs the first currency's net in whole units", () => {
    const totals = [
      { currency: "USD", incomeMinor: 0n, expenseMinor: 2_106_100n },
      { currency: "USD", incomeMinor: 0n, expenseMinor: 0n },
    ];
    expect(searchTotalText(totals)).toBe("−$21,061");
    expect(searchTotalText([])).toBeNull();
  });
});

describe("uniqueSearchRows", () => {
  it("draws a line a later page repeats only once, in its first place", () => {
    // A line that landed between two reads shifts the offset, so page 2 repeats page 1's last line.
    const first: SearchPage = { total: 4, expenses: [row("a"), row("b")] };
    const second: SearchPage = { total: 4, expenses: [row("b"), row("c")] };
    expect(uniqueSearchRows([first, second]).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

describe("rows", () => {
  it("names the customer on income and the supplier on an expense", () => {
    expect(searchRowTitle(row("a", { direction: "income", customer_name: "לקוח", supplier_name: "ספק" }))).toBe("לקוח");
    expect(searchRowTitle(row("b", { supplier_name: "ספק", customer_name: "לקוח" }))).toBe("ספק");
    expect(searchRowTitle(row("c", { description: "העברה" }))).toBe("העברה");
  });

  it("adds nothing to the month head for a kept-out line", () => {
    expect(searchRowAmount(row("k", { amount_net: -9_999n, kept_out: true })).minor).toBe(0n);
    expect(searchRowAmount(row("a", { amount_net: -1_000n })).minor).toBe(-1_000n);
  });

  it("counts in words", () => {
    expect(searchCountWords(1)).toBe("1 תנועה");
    expect(searchCountWords(7)).toBe("7 תנועות");
    expect(searchCountWords(0)).toBe("0 תנועות");
  });

  it("draws the current year's months without the year, other years with it", () => {
    const now = new Date(2026, 9, 17);
    expect(searchMonthTitle(2026, 9, now)).toBe("אוקטובר");
    expect(searchMonthTitle(2025, 9, now)).toBe("אוקטובר 2025");
  });
});

describe("filterSearchRows amount and names (sample and dev lists)", () => {
  it("matches the amount range, with a numeric description still matching by its text", () => {
    const rows = [
      row("amount", { description: "ספק", amount_net: -894_017n }),
      row("invoice", { description: "חשבונית 8940", amount_net: -10_000n }),
      row("other", { description: "ספק אחר", amount_net: -10_000n }),
    ];
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, q: "8940" }).map((r) => r.id)).toEqual(["invoice", "amount"]);
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, q: "חשבונית 8940" }).map((r) => r.id)).toEqual(["invoice"]);
  });

  it("matches the project and category names", () => {
    const rows = [row("p", { project_name: "Harbor Pier", category_name: "חומרים" }), row("q", { project_name: null })];
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, q: "harbor" }).map((r) => r.id)).toEqual(["p"]);
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, q: "חומרים" }).map((r) => r.id)).toEqual(["p"]);
  });
});

describe("filterSearchRows (sample and dev lists)", () => {
  const rows = [
    row("a", { supplier_name: "Northwind", project_id: "p1", category_id: "c1", doc_date: "2026-10-02" }),
    row("b", { direction: "income", customer_name: "לקוח", doc_date: "2026-09-02" }),
    row("c", { description: "מלט", waiting_review: true, doc_date: "2026-08-02" }),
  ];

  it("matches the text in any case, in the supplier, customer or description", () => {
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, q: "north" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, q: "לקוח" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, q: "מלט" }).map((r) => r.id)).toEqual(["c"]);
  });

  it("applies each chip", () => {
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, direction: "income" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, project: "p1" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, project: "none" }).map((r) => r.id)).toEqual(["b", "c"]);
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, category: "none" }).map((r) => r.id)).toEqual(["b", "c"]);
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, review: true }).map((r) => r.id)).toEqual(["c"]);
    expect(filterSearchRows(rows, { ...EMPTY_FILTERS, period: customRange("2026-09-01", "2026-09-30") }).map((r) => r.id)).toEqual(["b"]);
  });
});

describe("searchMonthTotals", () => {
  it("keys the server's month totals by month, ILS first", () => {
    const totals = searchMonthTotals([
      { month: "2026-09", currency: "USD", income_minor: 0n, expense_minor: 500n },
      { month: "2026-09", currency: "ILS", income_minor: 1_000n, expense_minor: 0n },
      { month: "2026-08", currency: "ILS", income_minor: 0n, expense_minor: 200n },
    ]);
    expect(totals?.get("2026-09")?.map((total) => total.currency)).toEqual(["ILS", "USD"]);
    expect(totals?.get("2026-08")).toEqual([{ currency: "ILS", incomeMinor: 0n, expenseMinor: 200n }]);
  });

  it("is undefined when the page has none", () => {
    expect(searchMonthTotals(null)).toBeUndefined();
    expect(searchMonthTotals(undefined)).toBeUndefined();
  });
});
