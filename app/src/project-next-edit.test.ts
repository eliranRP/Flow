import { describe, expect, it } from "vitest";
import { JUNIPER_NEXT } from "./dev/project-next-month-sample";
import {
  addMonths,
  categoryChoices,
  currencyMark,
  draftOf,
  forecastCategoryIds,
  formatDraft,
  historyBars,
  historyDiff,
  paceChoices,
  paceNextMonth,
  paceSummary,
  savedToast,
} from "./project-next-edit";
import { nextMonthForecast } from "./project-next-month";

const base = nextMonthForecast({ projectId: "juniper-ct", currency: "USD", today: JUNIPER_NEXT.today, recurring: JUNIPER_NEXT.expected.recurring, categoryMonths: JUNIPER_NEXT.categoryMonths });

function choices(query: string) {
  return categoryChoices({
    categories: JUNIPER_NEXT.categories ?? [],
    categoryMonths: JUNIPER_NEXT.categoryMonths,
    recurring: JUNIPER_NEXT.expected.recurring,
    projectId: "juniper-ct",
    currency: "USD",
    divisor: base.averageMonths,
    inForecast: forecastCategoryIds(base),
    query,
  });
}

describe("the pace sheet", () => {
  it("counts the next month of each pace from the forecast month, with the year a year on", () => {
    expect(paceChoices("2026-11").map((choice) => [choice.label, choice.description])).toEqual([
      ["פעם אחת · רק בנובמבר", "לא יחזור בצפי של החודשים הבאים"],
      ["כל חודש", "הבא בדצמבר"],
      ["כל חודשיים", "הבא בינואר"],
      ["כל רבעון", "הבא בפברואר"],
      ["כל שנה", "הבא בנובמבר 2027"],
    ]);
    expect(paceNextMonth("once", "2026-11")).toBeNull();
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("names the repeat row and the save's toast by the pace", () => {
    expect(paceSummary("once", "2026-11", false)).toEqual({ title: "חד פעמי", sub: "רק בצפי של נובמבר" });
    expect(paceSummary("quarter", "2026-11", false)).toEqual({ title: "הוצאה קבועה בצפי", sub: "מנובמבר · הבא בפברואר" });
    expect(paceSummary("month", "2026-11", true).title).toBe("הכנסה קבועה בצפי");
    expect(savedToast("once", "2026-11", "תיקונים ותחזוקה")).toBe("עודכן לנובמבר: תיקונים ותחזוקה");
    expect(savedToast("quarter", "2026-11", "הדברה")).toBe("עודכן כל רבעון: הדברה");
  });
});

describe("the amount field", () => {
  it("keeps digits, one point and two decimals, with thousands commas", () => {
    expect(formatDraft("1200")).toBe("1,200");
    expect(formatDraft("$1,234,567.891")).toBe("1,234,567.89");
    expect(formatDraft("12.")).toBe("12.");
    expect(formatDraft("007")).toBe("7");
    expect(formatDraft("")).toBe("");
  });

  it("writes an amount in minor units the way the field shows it", () => {
    expect(draftOf(-120_000n)).toBe("1,200");
    expect(draftOf(1_250n)).toBe("12.50");
    expect(currencyMark("USD")).toBe("$");
    expect(currencyMark("ILS")).toBe("₪");
  });
});

describe("historyBars", () => {
  it("is the category's five latest complete months and their average", () => {
    const bars = historyBars(JUNIPER_NEXT.categoryMonths, "repairs", "USD");
    expect(bars?.months.map((month) => [month.label, month.minor])).toEqual([
      ["מאי", 34_000n],
      ["יוני", 41_000n],
      ["יולי", 24_000n],
      ["אוג׳", 30_000n],
      ["ספט׳", 26_000n],
    ]);
    expect(bars?.usual).toBe(31_000n);
  });

  it("is null for a category with nothing in the project, or none at all", () => {
    expect(historyBars(JUNIPER_NEXT.categoryMonths, "rent", "USD")).toBeNull();
    expect(historyBars(JUNIPER_NEXT.categoryMonths, "repairs", "EUR")).toBeNull();
    expect(historyBars(null, "repairs", "USD")).toBeNull();
  });

  it("says how far the forecast is from the usual month", () => {
    expect(historyDiff(120_000n, 31_000n, "USD", "2026-11")).toEqual({ text: "גבוה ב־$890", high: true });
    expect(historyDiff(30_500n, 30_500n, "USD", "2026-11")).toEqual({ text: "כמו הרגיל", high: false });
    expect(historyDiff(20_000n, 31_000n, "USD", "2026-11")).toEqual({ text: "נמוך ב־$110", high: false });
    expect(historyDiff(null, 31_000n, "USD", "2026-11").text).toBe("הצפי לנובמבר מסומן");
  });
});

describe("categoryChoices", () => {
  it("suggests the project's categories the forecast leaves out, with a hint each, and lists the rest", () => {
    const { suggested, rest } = choices("");
    expect(suggested.map((choice) => [choice.name, choice.hint])).toEqual([
      ["ביטוח", "כל שנה · $1,240"],
      ["הדברה", "כל רבעון · $65"],
      ["ניהול נכס", "כל חודש · $305"],
    ]);
    // The forecast's own categories, the principal and income rent are not offered twice.
    const names = rest.map((choice) => choice.name);
    for (const name of ["תיקונים ותחזוקה", "ריבית הלוואות", "קרן הלוואות", "מסים וביטוח", "חשמל ומים"]) expect(names).not.toContain(name);
    expect(rest.find((choice) => choice.name === "גז")?.hint).toBe("אין תנועות בפרויקט");
    expect(rest.find((choice) => choice.name === "החזר ביטוח")?.hint).toBe("הכנסה");
  });

  it("keeps the names a search contains, and nothing for a name the company lacks", () => {
    const { suggested, rest } = choices("ביטוח");
    expect(suggested.map((choice) => choice.name)).toEqual(["ביטוח"]);
    expect(rest.map((choice) => choice.name)).toEqual(["ביטוח עסק", "החזר ביטוח"]);
    expect(choices("שמירה")).toEqual({ suggested: [], rest: [] });
  });

  it("hints a category used once and one used often by their months", () => {
    const base = JUNIPER_NEXT.categoryMonths;
    if (base == null) throw new Error("the fixture has its category months");
    const months = { ...base, categories: base.categories.filter((row) => row.id !== "taxes") };
    const result = categoryChoices({
      categories: JUNIPER_NEXT.categories ?? [],
      categoryMonths: months,
      recurring: [],
      projectId: "juniper-ct",
      currency: "USD",
      divisor: 6,
      inForecast: new Set(["repairs", "power", "loan-interest"]),
      query: "",
    });
    expect(result.suggested.find((choice) => choice.name === "ביטוח")?.hint).toBe("פעם אחת · $1,240 באפריל");
    expect(result.suggested.find((choice) => choice.name === "ניהול נכס")?.hint).toBe("ממוצע 6 חודשים בפרויקט: $305");
  });
});
