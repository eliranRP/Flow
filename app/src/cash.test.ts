// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  cashHistoryLabel,
  cashMonthName,
  cashSummaryRows,
  cashTitle,
  cashYearMonthRows,
  cashYearMonths,
  cashYearRows,
  cashYearSummaryRows,
  cashYearTitle,
  cashYearTotals,
  earlierMonthRows,
  shownCashRows,
} from "./cash";

const now = new Date("2026-10-10T08:00:00Z");

function row(currency: string, inMinor: bigint, outMinor: bigint, profit = 0n) {
  return {
    currency,
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
  };
}

describe("cash words and paths", () => {
  it("names a month, with its year only outside the current year", () => {
    expect(cashMonthName("2026-10", now)).toBe("אוקטובר");
    expect(cashMonthName("2025-12", now)).toBe("דצמבר 2025");
    expect(cashTitle("2026-09", now)).toBe("תזרים ספטמבר");
  });
});

describe("cashSummaryRows", () => {
  it("builds נכנס, יצא and a quiet רווח החודש, each opening what is behind it", () => {
    const rows = cashSummaryRows("2026-10", [row("ILS", 1_800_000n, 1_480_000n, 560_000n)], "", now);
    expect(rows.map((r) => [r.label, r.tone, r.href])).toEqual([
      ["נכנס", "in", "/cash/2026-10/in/ILS"],
      ["יצא", "out", "/cash/2026-10/out/ILS"],
      ["רווח החודש", "quiet", "/profit"],
    ]);
    // The profit view opens on the row's month.
    expect(rows[2]?.profitMonth).toBe("2026-10");
    expect(rows[0]?.name).toBe("נכנס באוקטובר ₪18,000 – פירוט");
  });
});

describe("the months", () => {
  const data = {
    basis: "paid" as const,
    base_currency: "ILS",
    months: [
      { month: "2026-10-01", by_currency: [row("ILS", 1_800_000n, 1_480_000n)] },
      { month: "2026-09-01", by_currency: [row("ILS", 100_000n, 215_000n), row("USD", 0n, 0n)] },
      { month: "2026-08-01", by_currency: [row("USD", 50_000n, 0n)] },
    ],
  };

  it("keeps the base currency first and always, and another only where it moved", () => {
    expect(shownCashRows(data.months[1], "ILS").map((r) => r.currency)).toEqual(["ILS"]);
    expect(shownCashRows(data.months[2], "ILS").map((r) => [r.currency, r.net_minor])).toEqual([
      ["ILS", 0n],
      ["USD", 50_000n],
    ]);
  });

  it("lists the earlier months by their net, a loss in red, each opening its page", () => {
    const rows = earlierMonthRows(data, "?preview=1", now);
    expect(rows.map((r) => [r.label, r.tone, r.href])).toEqual([
      ["ספטמבר", "net", "/cash/2026-09?preview=1"],
      ["אוגוסט", "net", "/cash/2026-08?preview=1"],
    ]);
    expect(rows[0]?.amounts).toEqual([{ currency: "ILS", minor: -115_000n }]);
    expect(rows[0]?.name).toBe("תזרים ספטמבר −₪1,150");
  });
});

describe("FLOW-417: cash history", () => {
  const years = {
    basis: "paid" as const,
    base_currency: "ILS",
    this_month: "2026-10-01",
    first_month: "2023-03-01",
    by_currency: [{ currency: "ILS", in_minor: 900n, out_minor: 400n, net_minor: 500n }],
    years: [
      { year: 2026, by_currency: [{ currency: "ILS", in_minor: 300n, out_minor: 100n, net_minor: 200n }] },
      { year: 2024, by_currency: [] },
      { year: 2023, by_currency: [{ currency: "ILS", in_minor: 100n, out_minor: 300n, net_minor: -200n }, { currency: "USD", in_minor: 0n, out_minor: 0n, net_minor: 0n }] },
    ],
  };

  it("names the band from the first cash month, and the current year's page runs to today", () => {
    expect(cashHistoryLabel("2023-03-01")).toBe("תזרים מאז מרץ 2023");
    expect(cashHistoryLabel(null)).toBe("תזרים");
    expect(cashYearTitle(2026, now)).toBe("תזרים 2026 עד היום");
    expect(cashYearTitle(2025, now)).toBe("תזרים 2025");
  });

  it("gives a row per year with its hint, a zero base row for an empty year, and no still currency", () => {
    const rows = cashYearRows(years, "?x=1");
    expect(rows.map((row) => [row.label, row.hint, row.href])).toEqual([
      ["2026", "10 חודשים", "/cash/year/2026?x=1"],
      ["2024", undefined, "/cash/year/2024?x=1"],
      ["2023", "מאז מרץ", "/cash/year/2023?x=1"],
    ]);
    expect(rows[1]?.amounts).toEqual([{ currency: "ILS", minor: 0n }]);
    expect(rows[2]?.amounts).toEqual([{ currency: "ILS", minor: -200n }]);
  });

  it("trims a year's months before the first cash month and sums the rest", () => {
    const data = {
      basis: "paid" as const,
      base_currency: "ILS",
      months: [
        { month: "2023-04-01", by_currency: [row("ILS", 100n, 50n)] },
        { month: "2023-03-01", by_currency: [row("ILS", 20n, 10n), row("USD", 0n, 5n)] },
        { month: "2023-02-01", by_currency: [row("ILS", 0n, 0n)] },
      ],
    };
    const shown = cashYearMonths(data, "2023-03-01");
    expect(shown.map((month) => month.month)).toEqual(["2023-04-01", "2023-03-01"]);
    const totals = cashYearTotals(shown, "ILS");
    expect(totals.map((total) => [total.currency, total.net_minor])).toEqual([
      ["ILS", 60n],
      ["USD", -5n],
    ]);
    expect(cashYearMonthRows(shown, "ILS", "").map((r) => [r.label, r.href])).toEqual([
      ["אפריל", "/cash/2023-04"],
      ["מרץ", "/cash/2023-03"],
    ]);
    expect(cashYearSummaryRows(2023, totals).every((r) => r.href == null)).toBe(true);
  });
});

describe("FLOW-417: the year row and the year page agree", () => {
  it("sums the sample year's months to the history's row for that year", async () => {
    const { sampleCashYearMonths, sampleCashYears } = await import("./dev/cash-sample");
    const months = sampleCashYearMonths(now);
    const year = Number(months.months[0]?.month.slice(0, 4));
    const page = cashYearTotals(cashYearMonths(months, null), "ILS")[0]?.net_minor;
    const row = sampleCashYears(now).years.find((entry) => entry.year === year)?.by_currency[0]?.net_minor;
    expect(page).toBe(row);
  });
});
