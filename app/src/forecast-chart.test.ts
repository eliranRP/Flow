import { describe, expect, it } from "vitest";
import { type ForecastBuild, type ForecastItem, forecastTotal } from "@flow/shared";
import { expenseCountNote, incomeCountNote, itemsCaption, monthEndChart, monthEndTakeaway } from "./forecast-chart";
import { monthForecastBoardSample } from "./forecast-sample";

function item(key: string, direction: "income" | "expense", kind: "recurring" | "invoice", lateDays = 0): ForecastItem {
  return {
    key, direction, kind, name: key, currency: "USD", usual: 10_000n, minor: 10_000n, day: null, description: null, due_on: null,
    moved_out: false, overridden: false, expected_on: null, late_days: lateDays, category_id: null, project_id: null, project_name: null,
  };
}

function build(income: ForecastItem[], expense: ForecastItem[], small: ForecastItem[] = []): Pick<ForecastBuild, "income" | "expense" | "small"> {
  return { income, expense, small };
}

describe("תזרים צפוי's card captions (spec-cash2)", () => {
  it("counts the board's items: late income, recurring charges with the small ones, and every item in the corner", () => {
    const { data, today } = monthForecastBoardSample("board");
    expect(incomeCountNote(data.build, today)).toBe("3 פריטים · 2 באיחור");
    expect(expenseCountNote(data.build)).toBe("13 פריטים, מהם 11 קבועים");
    expect(itemsCaption(data.build)).toBe("16 פריטים · פירוט למטה");
  });

  it("leaves a moved item out of the counts, as it is out of the totals", () => {
    const { data, today } = monthForecastBoardSample("changed");
    expect(incomeCountNote(data.build, today)).toBe("2 פריטים · אחד באיחור");
    expect(itemsCaption(data.build)).toBe("15 פריטים · פירוט למטה");
  });

  it("says one, none, all and nothing late in plain words", () => {
    const today = "2026-10-11";
    expect(incomeCountNote(build([], []), today)).toBe("אין הכנסה צפויה");
    expect(incomeCountNote(build([item("a", "income", "invoice")], []), today)).toBe("פריט אחד");
    expect(incomeCountNote(build([item("a", "income", "invoice", 3), item("b", "income", "recurring")], []), today)).toBe("2 פריטים · אחד באיחור");
    expect(expenseCountNote(build([], []))).toBe("אין הוצאה צפויה");
    expect(expenseCountNote(build([], [item("a", "expense", "recurring")]))).toBe("פריט אחד, קבוע");
    expect(expenseCountNote(build([], [item("a", "expense", "invoice")]))).toBe("פריט אחד");
    expect(expenseCountNote(build([], [item("a", "expense", "invoice"), item("b", "expense", "invoice")]))).toBe("2 פריטים");
    expect(expenseCountNote(build([], [item("a", "expense", "recurring")], [item("b", "expense", "recurring")]))).toBe("2 פריטים, כולם קבועים");
    expect(expenseCountNote(build([], [item("a", "expense", "invoice"), item("b", "expense", "recurring")]))).toBe("2 פריטים, מהם אחד קבוע");
    expect(itemsCaption(build([item("a", "income", "invoice")], []))).toBe("פריט אחד · פירוט למטה");
  });

  it("adds up: today plus what is still expected in, minus what is still expected out, is the month's end", () => {
    const { data, net } = monthForecastBoardSample("board");
    expect(net + data.build.incomeTotal - data.build.expenseTotal).toBe(forecastTotal(net, data.build));
    expect(forecastTotal(net, data.build)).toBe(-574_100n);
  });
});

describe("תזרים צפוי's chart", () => {
  it("draws May to September as they ended and October in progress, so far plus still expected", () => {
    const { data, months } = monthForecastBoardSample("board");
    const chart = monthEndChart("2026-10", months ?? new Map(), { incomeMinor: data.build.incomeTotal, expenseMinor: data.build.expenseTotal }, "USD");
    expect(chart.months.map((month) => month.label)).toEqual(["מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳ · צפי"]);
    expect(chart.months.at(-1)).toMatchObject({ incomeMinor: 2_487_800n, expenseMinor: 4_206_900n, ahead: { incomeMinor: 1_975_000n, expenseMinor: 830_000n } });
    expect(chart.months.slice(0, -1).every((month) => month.ahead == null)).toBe(true);
    expect(chart.sub).toBe("מאי עד סוף אוקטובר");
    expect(chart.label).toBe("נכנס ויצא לפי חודש, מאי עד סוף אוקטובר. אוקטובר עד היום: נכנס $24,878, יצא $42,069; צפוי עוד: נכנס $19,750, יצא $8,300");
  });

  it("starts at the first month with money for a young company, and keeps the month in progress alone", () => {
    const young = monthEndChart("2026-10", new Map([["2026-09", { incomeMinor: 100n, expenseMinor: 0n }]]), { incomeMinor: 0n, expenseMinor: 0n }, "USD");
    expect(young.months.map((month) => month.key)).toEqual(["2026-09", "2026-10"]);
    expect(young.sub).toBe("ספטמבר עד סוף אוקטובר");
    const first = monthEndChart("2026-10", new Map(), { incomeMinor: 5_000n, expenseMinor: 0n }, "USD");
    expect(first.months).toHaveLength(1);
    expect(first.sub).toBe("עד סוף אוקטובר");
    expect(first.label).toContain("אוקטובר עד היום: נכנס $0, יצא $0; צפוי עוד: נכנס $50, יצא $0");
  });
});

describe("monthEndTakeaway", () => {
  it("says where the month ends, the minus before the currency in an isolated amount", () => {
    expect(monthEndTakeaway("2026-10", -574_100n, "USD")).toBe("אוקטובר צפוי להיסגר ב־⁦−$5,741⁩");
    expect(monthEndTakeaway("2026-10", 120_000n, "USD")).toBe("אוקטובר צפוי להיסגר ב־⁦$1,200⁩");
  });

  it("says a month that ends at zero closes even, never ב־$0", () => {
    expect(monthEndTakeaway("2026-12", 0n, "USD")).toBe("דצמבר צפוי להיסגר באיזון");
  });
});
