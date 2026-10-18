import { describe, expect, it } from "vitest";
import { monthForecastBoardSample } from "../forecast-sample";
import { forecastCategories, itemCharge, OTHER_CATEGORY } from "./forecast-categories";

// לפי קטגוריה on the board's sample (an invented USD company on 2026-10-11): each category's month so
// far plus its items still to come, out then in, largest first.

const sample = monthForecastBoardSample("category");
const soFar = sample.soFar ?? { income: [], expense: [] };

describe("forecastCategories", () => {
  it("adds each category's items to its month so far and sums each side at the month's end", () => {
    const [out, into] = forecastCategories(sample.data.build, soFar, new Map(), sample.today);
    expect(out?.direction).toBe("expense");
    expect(out?.rows.map((row) => [row.name, row.soFar, row.ahead, row.end])).toEqual([
      ["חומרים", 1_524_000n, 313_800n, 1_837_800n],
      ["קבלני משנה", 1_186_000n, 420_000n, 1_606_000n],
      ["תשלומי הלוואות", 1_018_200n, 0n, 1_018_200n],
      ["חשבונות קבועים", 298_700n, 96_200n, 394_900n],
      [OTHER_CATEGORY, 180_000n, 0n, 180_000n],
    ]);
    expect(out?.total).toBe(5_036_900n);
    expect(into?.rows.map((row) => row.name)).toEqual(["הכנסה מלקוחות", "שכירות"]);
    expect(into?.total).toBe(4_462_800n);
  });

  it("names a late item, or counts them when there are more", () => {
    const [out, into] = forecastCategories(sample.data.build, soFar, new Map(), sample.today);
    expect(out?.rows.find((row) => row.key === "cat-bills")?.late.map((item) => item.name)).toEqual(["Streaming"]);
    expect(into?.rows.find((row) => row.key === "cat-clients")?.late).toHaveLength(1);
  });

  it("puts an item whose category has no figure yet in its own row, named from the categories list", () => {
    const build = { ...sample.data.build, income: sample.data.build.income.map((item) => ({ ...item, category_id: "cat-new" })) };
    const [, into] = forecastCategories(build, { income: [], expense: [] }, new Map([["cat-new", "דמי ניהול"]]), sample.today);
    expect(into?.rows.map((row) => [row.name, row.soFar])).toEqual([["דמי ניהול", 0n]]);
  });
});

describe("itemCharge", () => {
  it("reads a recurring item's party and project from its key, and nothing from an invoice", () => {
    const rent = sample.data.build.income.find((item) => item.kind === "recurring");
    expect(rent == null ? null : itemCharge(rent)).toEqual({ direction: "income", partyId: "elm", projectId: null });
    expect(rent == null ? null : itemCharge({ ...rent, key: "party:expense:p-1:USD:proj-2", direction: "expense" })).toEqual({ direction: "expense", partyId: "p-1", projectId: "proj-2" });
    const invoice = sample.data.build.income.find((item) => item.kind === "invoice");
    expect(invoice == null ? "missing" : itemCharge(invoice)).toBeNull();
  });
});
