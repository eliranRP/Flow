// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cashMonthName, cashSummaryRows, cashTitle, earlierMonthRows, profitMonthPath, shownCashRows } from "./cash";

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

  it("opens the profit view on the month, keeping a preview flag", () => {
    expect(profitMonthPath("2026-09", "")).toBe("/profit?period=month&at=2026-09");
    expect(profitMonthPath("2026-09", "?preview=1")).toBe("/profit?period=month&at=2026-09&preview=1");
  });
});

describe("cashSummaryRows", () => {
  it("builds נכנס, יצא and a quiet רווח החודש, each opening what is behind it", () => {
    const rows = cashSummaryRows("2026-10", [row("ILS", 1_800_000n, 1_480_000n, 560_000n)], "", now);
    expect(rows.map((r) => [r.label, r.tone, r.href])).toEqual([
      ["נכנס", "in", "/cash/2026-10/in/ILS"],
      ["יצא", "out", "/cash/2026-10/out/ILS"],
      ["רווח החודש", "quiet", "/profit?period=month&at=2026-10"],
    ]);
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
