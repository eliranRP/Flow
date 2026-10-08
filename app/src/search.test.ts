import type { SearchPage, SearchRow } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { allTime, customRange, presetPeriod } from "./period";
import {
  EMPTY_FILTERS,
  SEARCH_MAX_LENGTH,
  SEARCH_PAGE,
  filterSearchRows,
  hasChipFilters,
  nextSearchOffset,
  readSearchFilters,
  searchArgs,
  searchCountWords,
  searchFiltersQuery,
  searchRowAmount,
  searchRowTitle,
  searchTotals,
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

describe("paging", () => {
  const page = (count: number, total: number): SearchPage => ({ total, expenses: Array.from({ length: count }, (_, i) => row(`r${String(i)}`)) });

  it("asks for the next offset until every line is loaded", () => {
    const first = page(SEARCH_PAGE, 120);
    expect(nextSearchOffset(first, [first])).toBe(SEARCH_PAGE);
    const second = page(SEARCH_PAGE, 120);
    expect(nextSearchOffset(second, [first, second])).toBe(SEARCH_PAGE * 2);
    const last = page(20, 120);
    expect(nextSearchOffset(last, [first, second, last])).toBeUndefined();
  });

  it("stops on an empty page even if the total moved", () => {
    const first = page(SEARCH_PAGE, 120);
    const empty = page(0, 120);
    expect(nextSearchOffset(empty, [first, empty])).toBeUndefined();
  });
});

describe("rows", () => {
  it("names the customer on income and the supplier on an expense", () => {
    expect(searchRowTitle(row("a", { direction: "income", customer_name: "לקוח", supplier_name: "ספק" }))).toBe("לקוח");
    expect(searchRowTitle(row("b", { supplier_name: "ספק", customer_name: "לקוח" }))).toBe("ספק");
    expect(searchRowTitle(row("c", { description: "העברה" }))).toBe("העברה");
  });

  it("totals money out and in per currency, ILS first, with kept-out lines adding nothing", () => {
    const totals = searchTotals([
      row("u", { currency: "USD", amount_net: -500n }),
      row("a", { amount_net: -1_000n }),
      row("b", { amount_net: 2_500n, direction: "income" }),
      row("k", { amount_net: -9_999n, kept_out: true }),
    ]);
    expect(totals).toEqual([
      { currency: "ILS", incomeMinor: 2_500n, expenseMinor: 1_000n },
      { currency: "USD", incomeMinor: 0n, expenseMinor: 500n },
    ]);
    expect(searchRowAmount(row("k", { kept_out: true })).minor).toBe(0n);
  });

  it("counts in words", () => {
    expect(searchCountWords(1)).toBe("תנועה אחת");
    expect(searchCountWords(7)).toBe("7 תנועות");
    expect(searchCountWords(0)).toBe("0 תנועות");
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
