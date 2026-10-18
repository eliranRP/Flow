// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  cashLineSplit,
  cashMonthName,
  cashSummaryRows,
  cashTitle,
  notInProfitHint,
  notInProfitRest,
  shownCashRows,
} from "./cash";

const now = new Date("2026-10-10T08:00:00Z");

function row(currency: string, inMinor: bigint, outMinor: bigint, profit = inMinor - outMinor, kept: { name: string; amount_minor: bigint }[] = []) {
  return {
    currency,
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
    not_in_profit_categories: kept,
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
    const rows = cashSummaryRows("2026-10", [row("ILS", 1_800_000n, 1_480_000n)], "", now);
    expect(rows.map((r) => [r.label, r.tone, r.href])).toEqual([
      ["נכנס", "in", "/cash/2026-10/in/ILS"],
      ["יצא", "out", "/cash/2026-10/out/ILS"],
      ["רווח החודש", "quiet", "/profit"],
    ]);
    expect(rows[0]?.name).toBe("נכנס באוקטובר ₪18,000 – פירוט");
  });

  it("names an earlier month on its profit row, and keeps רווח החודש on the current month (FLOW-362)", () => {
    const rows = cashSummaryRows("2026-09", [row("ILS", 1_800_000n, 1_480_000n)], "", now);
    expect(rows[2]?.label).toBe("רווח בספטמבר");
    // The profit view opens on the row's month, as Home names it.
    expect(rows[2]?.href).toBe("/profit?month=2026-09");
    expect(cashSummaryRows("2026-09", [row("ILS", 0n, 0n)], "?preview=ready", now)[2]?.href).toBe("/profit?month=2026-09&preview=ready");
    expect(rows[2]?.name).toBe("רווח בספטמבר ₪3,200");
    expect(cashSummaryRows("2025-12", [row("ILS", 0n, 0n)], "", now)[2]?.label).toBe("רווח בדצמבר 2025");
  });

  it("adds לא נספר ברווח, the rest of the month's figure, with a hint and its lines (FLOW-418)", () => {
    const kept = [
      { name: "שיפוץ והשבחה", amount_minor: -440_000n },
      { name: "השקעת בעלים", amount_minor: 200_000n },
    ];
    const rows = cashSummaryRows("2026-10", [row("ILS", 1_800_000n, 1_480_000n, 560_000n, kept)], "", now);
    expect(rows.map((r) => [r.label, r.tone, r.href])).toEqual([
      ["נכנס", "in", "/cash/2026-10/in/ILS"],
      ["יצא", "out", "/cash/2026-10/out/ILS"],
      ["רווח החודש", "quiet", "/profit"],
      ["לא נספר ברווח", "aside", "/cash/2026-10/kept/ILS"],
    ]);
    // רווח החודש and לא נספר ברווח add up to the month's figure.
    expect(rows[3]?.amounts).toEqual([{ currency: "ILS", minor: -240_000n }]);
    expect(rows[3]?.hint).toBe("שיפוץ והשבחה, השקעת בעלים");
    expect(rows[3]?.name).toBe("לא נספר ברווח באוקטובר −₪2,400 – פירוט");
  });

  it("names the two largest categories and says when there are more", () => {
    const kept = ["א", "ב", "ג"].map((name) => ({ name, amount_minor: -100n }));
    expect(notInProfitHint(row("ILS", 0n, 300n, 0n, kept))).toBe("א, ב ועוד");
    expect(notInProfitHint(row("ILS", 0n, 0n))).toBeUndefined();
  });

  it("keeps what the categories don't cover, VAT for one, as the rest", () => {
    const kept = [{ name: "שיפוץ והשבחה", amount_minor: -100_000n }];
    expect(notInProfitRest(row("ILS", 0n, 118_000n, -18_000n, kept))).toBe(0n);
    expect(notInProfitRest(row("ILS", 0n, 118_000n, 0n, kept))).toBe(-18_000n);
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
});

describe("cashLineSplit (FLOW-432)", () => {
  it("names a split line's counted parts, unsigned, with cents only when they have them, and the whole line", () => {
    const row = {
      currency: "USD",
      line_minor: 205_486n,
      parts: [
        { name: "מים וביוב", amount_minor: -18_310n },
        { name: null, amount_minor: -17_100n },
      ],
    };
    expect(cashLineSplit(row)).toEqual({
      parts: [
        { name: "מים וביוב", amount: "$183.10" },
        { name: "חלק", amount: "$171" },
      ],
      total: "$2,054.86",
    });
  });

  it("names a loan payment's part, out of the whole payment (FLOW-442)", () => {
    const row = { currency: "USD", part: "principal", amount_minor: 90_000n, line_minor: 150_000n, parts: null };
    expect(cashLineSplit(row)).toEqual({ parts: [{ name: "קרן", amount: "$900" }], total: "$1,500" });
    expect(cashLineSplit({ ...row, part: "escrow", amount_minor: 10_000n })?.parts[0]?.name).toBe("מסים וביטוח");
    expect(cashLineSplit({ ...row, line_minor: null })).toBeNull();
  });

  it("is null for a line with no split", () => {
    expect(cashLineSplit({ currency: "USD", line_minor: null, parts: null })).toBeNull();
    expect(cashLineSplit({ currency: "USD" })).toBeNull();
  });
});
