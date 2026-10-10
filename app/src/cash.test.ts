// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cashMonthName, cashSummaryRows, cashTitle, earlierMonthRows, notInProfitHint, notInProfitRest, shownCashRows } from "./cash";

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
    // The profit view opens on the row's month.
    expect(rows[2]?.profitMonth).toBe("2026-10");
    expect(rows[0]?.name).toBe("נכנס באוקטובר ₪18,000 – פירוט");
  });

  it("adds לא נספר ברווח, the rest of the month's figure, with a hint and its lines (FLOW-417)", () => {
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
