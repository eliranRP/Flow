import type { ExpectedParty, ProjectCategoryMonths } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { JUNIPER_NEXT } from "./dev/project-next-month-sample";
import {
  basisLine,
  dueInMonth,
  expectedDate,
  monthlyOverheadShare,
  nextMonthForecast,
  nextMonthKey,
} from "./project-next-month";

function party(overrides: Partial<ExpectedParty>): ExpectedParty {
  return {
    direction: "expense",
    party_id: "s-1",
    name: "Example Servicing",
    currency: "USD",
    typical_amount_minor: -10_000n,
    typical_day: 5,
    months_seen: 6,
    seen_this_month: false,
    project_id: "p-1",
    category_id: "cat-a",
    pace: "month",
    next_due_month: "2026-11",
    ...overrides,
  };
}

function categories(rows: { id: string | null; name: string; months: number[]; currency?: string }[]): ProjectCategoryMonths {
  return {
    project_id: "p-1",
    today: "2026-10-11",
    this_month: "2026-10-01",
    months: [],
    categories: rows.map((row) => ({
      id: row.id,
      name: row.name,
      group_name: null,
      currency: row.currency ?? "USD",
      this_month_minor: 0,
      months_minor: row.months,
      months_seen: 0,
      expected_minor: null,
      typical_day: null,
      flag: null,
    })),
  };
}

function forecast(recurring: ExpectedParty[], months: ProjectCategoryMonths | null = null, today = "2026-10-11") {
  return nextMonthForecast({ projectId: "p-1", currency: "USD", today, recurring, categoryMonths: months });
}

describe("nextMonthKey", () => {
  it("is the month after today's, across the year end", () => {
    expect(nextMonthKey("2026-10-11")).toBe("2026-11");
    expect(nextMonthKey("2026-12-31")).toBe("2027-01");
  });
});

describe("dueInMonth (the pace filter)", () => {
  it("counts a monthly charge every month from its due month", () => {
    expect(dueInMonth("2026-11", "month", "2026-11", "2026-10")).toBe(true);
    expect(dueInMonth("2026-10", "month", "2026-11", "2026-10")).toBe(true);
  });

  it("counts a charge every 2 months only in its due months", () => {
    expect(dueInMonth("2026-11", "2months", "2026-11", "2026-10")).toBe(true);
    expect(dueInMonth("2026-10", "2months", "2026-11", "2026-10")).toBe(false);
    expect(dueInMonth("2026-12", "2months", "2026-11", "2026-10")).toBe(false);
  });

  it("counts a quarterly charge three months apart", () => {
    expect(dueInMonth("2026-11", "quarter", "2026-11", "2026-10")).toBe(true);
    expect(dueInMonth("2026-12", "quarter", "2026-11", "2026-10")).toBe(false);
    expect(dueInMonth("2026-08", "quarter", "2026-11", "2026-08")).toBe(true);
  });

  it("still expects a late monthly charge next month", () => {
    expect(dueInMonth("2026-08", "month", "2026-11", "2026-10")).toBe(true);
  });

  it("counts a late charge from this month, as expected_months does", () => {
    // Due in August and not come: expected from October, so every 2 months is October, December, …
    expect(dueInMonth("2026-08", "2months", "2026-11", "2026-10")).toBe(false);
    expect(dueInMonth("2026-08", "2months", "2026-12", "2026-10")).toBe(true);
  });

  it("counts a monthly charge with no due month from this month", () => {
    expect(dueInMonth(null, "month", "2026-11", "2026-10")).toBe(true);
  });

  it("counts a yearly charge only in its due month", () => {
    expect(dueInMonth("2026-11", "year", "2026-11", "2026-10")).toBe(true);
    expect(dueInMonth("2027-11", "year", "2026-11", "2026-10")).toBe(false);
  });

  it("counts a late yearly charge from this month, so not next month", () => {
    // Due last November and not come: expected from October, a gap of 1 to November.
    expect(dueInMonth("2025-11", "year", "2026-11", "2026-10")).toBe(false);
  });
});

describe("expectedDate", () => {
  it("puts the typical day in the month, clamped to its length", () => {
    expect(expectedDate("2026-11", 4)).toBe("2026-11-04");
    expect(expectedDate("2026-11", 31)).toBe("2026-11-30");
    expect(expectedDate("2027-02", 30)).toBe("2027-02-28");
    expect(expectedDate("2028-02", 30)).toBe("2028-02-29");
  });
});

describe("nextMonthForecast", () => {
  it("lists the due charges by day, signed, and sums income and expenses", () => {
    const result = forecast([
      party({ party_id: "s-late", name: "Late Co", typical_day: 20, next_due_month: "2026-09" }),
      party({ party_id: "c-1", name: "A. Rivera", direction: "income", typical_amount_minor: 185_000n, typical_day: 1, category_id: "rent" }),
      party({ party_id: "s-q", name: "Quarterly Co", pace: "quarter", next_due_month: "2026-12", category_id: "cat-q" }),
      party({ party_id: "s-eur", name: "Other Currency", currency: "EUR" }),
      party({ party_id: "s-other", name: "Other Project", project_id: "p-2" }),
    ]);
    expect(result.month).toBe("2026-11");
    expect(result.rows.map((row) => [row.name, row.date, row.minor])).toEqual([
      ["A. Rivera", "2026-11-01", 185_000n],
      ["Late Co", "2026-11-20", -10_000n],
    ]);
    expect(result.incomeMinor).toBe(185_000n);
    expect(result.expenseMinor).toBe(10_000n);
    expect(result.netMinor).toBe(175_000n);
    expect(result.recurringCount).toBe(2);
  });

  it("adds an average row for a category no recurring charge files to, last", () => {
    const result = forecast(
      [party({ category_id: "cat-a" }), party({ party_id: "s-q", pace: "quarter", next_due_month: "2027-01", category_id: "cat-q" })],
      categories([
        { id: "cat-a", name: "ריבית", months: [10_000, 10_000, 10_000, 10_000, 10_000, 10_000] },
        { id: "cat-q", name: "מים", months: [0, 0, 9_000, 0, 0, 9_000] },
        { id: "repairs", name: "תיקונים", months: [29_000, 34_000, 41_000, 24_000, 30_000, 28_000] },
        { id: "garden", name: "גינה", months: [0, 0, 0, 0, 0, 0] },
        { id: "refunds", name: "החזרים", months: [0, -6_000, 0, 0, 0, 0] },
        { id: "eur", name: "אירו", months: [6_000, 0, 0, 0, 0, 0], currency: "EUR" },
      ]),
    );
    expect(result.rows.map((row) => [row.kind, row.name, row.minor])).toEqual([
      ["recurring", "Example Servicing", -10_000n],
      ["average", "תיקונים", -31_000n],
    ]);
    expect(result.averageNames).toEqual(["תיקונים"]);
    expect(result.averageMonths).toBe(6);
  });

  it("drops a one-off cost in a category a recurring charge files to", () => {
    // The recurring charge is due in January, not next month, and still keeps its category out.
    const result = forecast(
      [party({ pace: "quarter", next_due_month: "2027-01", category_id: "cat-a" })],
      categories([{ id: "cat-a", name: "ריבית", months: [0, 0, 0, 60_000, 0, 0] }]),
    );
    expect(result.rows).toEqual([]);
  });

  it("averages the uncategorized expenses as one row named אחר", () => {
    const result = forecast([], categories([
      { id: "repairs", name: "תיקונים", months: [6_000, 6_000, 6_000, 6_000, 6_000, 6_000] },
      { id: null, name: "", months: [3_000, 0, 3_000, 0, 3_000, 3_000] },
    ]));
    expect(result.rows.map((row) => [row.key, row.name, row.minor])).toEqual([
      ["avg:repairs", "תיקונים", -6_000n],
      ["avg:none", "אחר", -2_000n],
    ]);
  });

  it("averages a younger project over the months since its first expense", () => {
    // The first expense of any category is in June: four months to September, not six.
    const result = forecast([], categories([
      { id: "repairs", name: "תיקונים", months: [0, 0, 0, 0, 20_000, 20_000] },
      { id: "garden", name: "גינה", months: [0, 0, 8_000, 0, 0, 0] },
    ]));
    expect(result.averageMonths).toBe(4);
    expect(result.rows.map((row) => [row.name, row.minor])).toEqual([["תיקונים", -10_000n], ["גינה", -2_000n]]);
  });

  it("averages over one month when the only expense is last month's", () => {
    const result = forecast([], categories([{ id: "repairs", name: "תיקונים", months: [0, 0, 0, 0, 0, 7_000] }]));
    expect(result.averageMonths).toBe(1);
    expect(result.rows.map((row) => row.minor)).toEqual([-7_000n]);
  });

  it("leaves a loan payment out and counts its interest and escrow from their categories, without principal", () => {
    // The servicer's usual amount is the whole payment: 1,180 interest + 280 escrow + 420 principal.
    const result = forecast(
      [
        party({ party_id: "s-loan", name: "Example Mortgage", typical_amount_minor: -188_000n, category_id: "interest", pays_loan: true }),
        party({ party_id: "s-water", name: "Example Water", typical_amount_minor: -12_000n, category_id: "water" }),
      ],
      categories([
        { id: "interest", name: "ריבית הלוואות", months: [118_000, 118_000, 118_000, 118_000, 118_000, 118_000] },
        { id: "escrow", name: "מסים וביטוח", months: [28_000, 28_000, 28_000, 28_000, 28_000, 28_000] },
        { id: "water", name: "מים", months: [12_000, 12_000, 12_000, 12_000, 12_000, 12_000] },
      ]),
    );
    expect(result.rows.map((row) => [row.kind, row.name, row.minor])).toEqual([
      ["recurring", "Example Water", -12_000n],
      ["average", "ריבית הלוואות", -118_000n],
      ["average", "מסים וביטוח", -28_000n],
    ]);
    expect(result.expenseMinor).toBe(158_000n);
    expect(result.recurringCount).toBe(1);
  });

  it("rounds an average to the cent and orders averages by size", () => {
    const result = forecast([], categories([
      { id: "a", name: "קטן", months: [100, 0, 0, 0, 0, 0] },
      { id: "b", name: "גדול", months: [1_000, 0, 0, 0, 0, 0] },
    ]));
    expect(result.rows.map((row) => [row.name, row.minor])).toEqual([["גדול", -167n], ["קטן", -17n]]);
  });

  it("makes the board's November from the dev fixture", () => {
    const result = nextMonthForecast({ projectId: "juniper-ct", currency: "USD", today: JUNIPER_NEXT.today, recurring: JUNIPER_NEXT.expected.recurring, categoryMonths: JUNIPER_NEXT.categoryMonths });
    expect(result.incomeMinor).toBe(415_000n);
    expect(result.expenseMinor).toBe(177_000n);
    expect(result.netMinor).toBe(238_000n);
    expect(result.rows.map((row) => [row.name, row.minor])).toEqual([
      ["M. Ortiz", 185_000n],
      ["S. Kim", 230_000n],
      ["ריבית הלוואות", -118_000n],
      ["תיקונים ותחזוקה", -31_000n],
      ["מסים וביטוח", -28_000n],
    ]);
    expect(basisLine(result.recurringCount, result.averageNames)).toBe("2 קבועים וממוצע 3 קטגוריות");
  });
});

describe("basisLine", () => {
  it("names one average category, counts several, and leaves out none", () => {
    expect(basisLine(4, ["תיקונים"])).toBe("4 קבועים וממוצע תיקונים");
    expect(basisLine(4, ["תיקונים", "גינה"])).toBe("4 קבועים וממוצע 2 קטגוריות");
    expect(basisLine(4, [])).toBe("4 קבועים");
    expect(basisLine(1, [])).toBe("קבוע אחד");
    expect(basisLine(0, ["תיקונים"])).toBe("ממוצע תיקונים");
  });
});

describe("monthlyOverheadShare", () => {
  it("is the period's share over its months", () => {
    expect(monthlyOverheadShare(304_000n, 20)).toBe(15_200n);
    expect(monthlyOverheadShare(100n, 3)).toBe(33n);
    expect(monthlyOverheadShare(200n, 3)).toBe(67n);
  });

  it("is null with no share or no months", () => {
    expect(monthlyOverheadShare(null, 20)).toBeNull();
    expect(monthlyOverheadShare(304_000n, 0)).toBeNull();
  });
});
