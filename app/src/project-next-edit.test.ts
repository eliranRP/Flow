import { formatAmountText } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { JUNIPER_NEXT, JUNIPER_NEXT_LOAN, JUNIPER_NEXT_SECOND_RENT } from "./dev/project-next-month-sample";
import {
  addMonths,
  categoryChoices,
  currencyMark,
  draftOf,
  forecastCategoryAmounts,
  formatDraft,
  historyBars,
  historyDiff,
  paceChoices,
  paceNextMonth,
  paceSummary,
  savedToast,
} from "./project-next-edit";
import { applyForecastEdits, nextMonthForecast, type ProjectForecastEdit } from "./project-next-month";
import { loanOutlook } from "./screens/loan-outlook";

const base = nextMonthForecast({ projectId: "juniper-ct", currency: "USD", today: JUNIPER_NEXT.today, recurring: JUNIPER_NEXT.expected.recurring, categoryMonths: JUNIPER_NEXT.categoryMonths });

function choices(query: string) {
  return categoryChoices({
    categories: JUNIPER_NEXT.categories ?? [],
    categoryMonths: JUNIPER_NEXT.categoryMonths,
    recurring: JUNIPER_NEXT.expected.recurring,
    projectId: "juniper-ct",
    currency: "USD",
    divisor: base.averageMonths,
    inForecast: forecastCategoryAmounts(base),
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
  it("suggests the project's categories with a hint each, and lists the rest", () => {
    const { suggested, rest } = choices("");
    expect(suggested.map((choice) => [choice.name, choice.hint])).toEqual([
      ["ביטוח", "כל שנה · $1,240"],
      ["הדברה", "כל רבעון · $65"],
      ["חשמל ומים", "כבר בצפי · $95"],
      ["מסים וביטוח", "כבר בצפי · $280"],
      ["ניהול נכס", "כל חודש · $305"],
      ["ריבית הלוואות", "כבר בצפי · $1,180"],
      ["שכירות", "כבר בצפי · $4,150"],
      ["תיקונים ותחזוקה", "כבר בצפי · $310"],
    ]);
    // The principal is never offered; the rest have no months in the project.
    const names = rest.map((choice) => choice.name);
    expect(names).not.toContain("קרן הלוואות");
    expect(rest.find((choice) => choice.name === "גז")?.hint).toBe("אין תנועות בפרויקט");
    expect(rest.find((choice) => choice.name === "החזר ביטוח")?.hint).toBe("הכנסה");
  });

  it("offers a category the forecast already counts, in its own list, with the forecast's amount (decision 0259)", () => {
    // The rent category has two tenants' charges in the forecast: it stays suggested, and its kind stays income.
    const rent = choices("שכירות").suggested.find((choice) => choice.id === "rent");
    expect(rent).toEqual({ id: "rent", name: "שכירות", kind: "income", hint: "כבר בצפי · $4,150" });
    // An added line in a category the project never used: it stays in the rest, its hint says it is in.
    const result = categoryChoices({
      categories: JUNIPER_NEXT.categories ?? [],
      categoryMonths: JUNIPER_NEXT.categoryMonths,
      recurring: [],
      projectId: "juniper-ct",
      currency: "USD",
      divisor: 6,
      inForecast: new Map([["c-3", 4_000n], ["deposit", 0n]]),
      query: "",
    });
    expect(result.rest.find((choice) => choice.id === "c-3")?.hint).toBe("כבר בצפי · $40");
    expect(result.rest.find((choice) => choice.id === "deposit")?.hint).toBe("כבר בצפי");
    expect(result.suggested.find((choice) => choice.id === "c-3")).toBeUndefined();
  });

  it("still leaves out the hidden, the loan principal and the kept-out-of-profit categories", () => {
    const categories = [
      ...(JUNIPER_NEXT.categories ?? []),
      { id: "hidden", name: "מוסתרת", kind: "expense" as const, hidden: true, is_default: false, loan_part: null },
      { id: "owner-draw", name: "משיכת בעלים", kind: "expense" as const, hidden: false, is_default: false, loan_part: null, excluded_from_pnl: true },
    ];
    const result = categoryChoices({
      categories,
      categoryMonths: JUNIPER_NEXT.categoryMonths,
      recurring: [],
      projectId: "juniper-ct",
      currency: "USD",
      divisor: 6,
      inForecast: new Map([["hidden", 100n], ["owner-draw", 100n], ["loan-principal", 100n]]),
      query: "",
    });
    const ids = [...result.suggested, ...result.rest].map((choice) => choice.id);
    for (const id of ["hidden", "owner-draw", "loan-principal"]) expect(ids).not.toContain(id);
  });

  it("keeps the names a search contains, and nothing for a name the company lacks", () => {
    const { suggested, rest } = choices("ביטוח");
    expect(suggested.map((choice) => choice.name)).toEqual(["ביטוח", "מסים וביטוח"]);
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
      inForecast: new Map([["repairs", 31_000n], ["power", 9_500n], ["loan-interest", 118_000n]]),
      query: "",
    });
    expect(result.suggested.find((choice) => choice.name === "ביטוח")?.hint).toBe("פעם אחת · $1,240 באפריל");
    expect(result.suggested.find((choice) => choice.name === "ניהול נכס")?.hint).toBe("ממוצע 6 חודשים בפרויקט: $305");
  });
});

describe("the edit page's figures with a loan row (decision 0190)", () => {
  const loanForecast = nextMonthForecast({
    projectId: "juniper-ct",
    currency: "USD",
    today: JUNIPER_NEXT_LOAN.today,
    recurring: JUNIPER_NEXT_LOAN.expected.recurring,
    categoryMonths: JUNIPER_NEXT_LOAN.categoryMonths,
    loans: JUNIPER_NEXT_LOAN.loans,
    categories: JUNIPER_NEXT_LOAN.categories,
  });

  it("counts the loan rows' categories as in the forecast, so the category sheet says so", () => {
    const inForecast = forecastCategoryAmounts(loanForecast);
    expect([...inForecast.keys()].sort()).toEqual(["loan-interest", "power", "rent", "repairs", "taxes"]);
    const result = categoryChoices({
      categories: JUNIPER_NEXT_LOAN.categories ?? [],
      categoryMonths: JUNIPER_NEXT_LOAN.categoryMonths,
      recurring: JUNIPER_NEXT_LOAN.expected.recurring,
      projectId: "juniper-ct",
      currency: "USD",
      divisor: loanForecast.averageMonths,
      inForecast,
      query: "",
    });
    const choices = [...result.suggested, ...result.rest];
    const escrow = loanForecast.rows.find((row) => row.categoryId === "taxes")?.minor ?? 0n;
    expect(choices.find((choice) => choice.id === "taxes")?.hint).toBe(`כבר בצפי · ${formatAmountText(-escrow, "USD")}`);
    expect(choices.map((choice) => choice.id)).not.toContain("loan-principal");
  });

  it("shows the interest category's own months next to the loan row's amount", () => {
    const bars = historyBars(JUNIPER_NEXT_LOAN.categoryMonths, "loan-interest", "USD");
    const loan = JUNIPER_NEXT_LOAN.loans?.[0];
    const september = BigInt(JUNIPER_NEXT_LOAN.categoryMonths?.categories.find((row) => row.id === "loan-interest")?.months_minor.at(-1) ?? 0);
    expect(bars?.months.map((bar) => bar.minor)).toEqual([0n, 0n, 0n, 0n, september]);
    const next = loan == null ? null : loanOutlook(loan, JUNIPER_NEXT_LOAN.today)?.next;
    expect(next?.dueDate).toBe("2026-11-01");
    expect(loanForecast.rows.find((row) => row.key === "avg:loan-interest")?.minor).toBe(-(next?.interestMinor ?? 0n));
    expect(next?.interestMinor).not.toBe(september);
  });
});

describe("many added lines in one category (FLOW-1063, decision 0259)", () => {
  const rentBase = nextMonthForecast({ projectId: "juniper-ct", currency: "USD", today: JUNIPER_NEXT.today, recurring: JUNIPER_NEXT.expected.recurring, categoryMonths: JUNIPER_NEXT.categoryMonths });
  const added = JUNIPER_NEXT_SECOND_RENT.edits ?? [];
  const rentKeys = (edits: readonly ProjectForecastEdit[]) => applyForecastEdits(rentBase, edits).rows.filter((row) => row.categoryId === "rent").map((row) => row.key);

  it("lists an added line next to the recurring incomes of its category, each its own row, as an income", () => {
    const result = applyForecastEdits(rentBase, added);
    expect(rentKeys(added)).toEqual(["rec:income:c-ortiz", "rec:income:c-kim", "add:e-rent-2"]);
    expect(result.rows.find((row) => row.key === "add:e-rent-2")).toMatchObject({ direction: "income", minor: 100_000n, name: "שכירות" });
    expect(result.incomeMinor).toBe(rentBase.incomeMinor + 100_000n);
    expect(forecastCategoryAmounts(result).get("rent")).toBe(515_000n);
  });

  it("keeps two added lines in one category apart, and removing one leaves the other", () => {
    const third: ProjectForecastEdit = { ...added[0] as ProjectForecastEdit, id: "e-rent-3", amount_minor: 50_000, pace: "once" };
    expect(rentKeys([...added, third])).toEqual(["rec:income:c-ortiz", "rec:income:c-kim", "add:e-rent-2", "add:e-rent-3"]);
    const removeAdded: ProjectForecastEdit = { id: "e-off", kind: "remove", row_key: "add:e-rent-2", category_id: null, direction: null, amount_minor: null, pace: "once", start_month: "2026-11" };
    expect(rentKeys([...added, third, removeAdded])).toEqual(["rec:income:c-ortiz", "rec:income:c-kim", "add:e-rent-3"]);
    // Taking out a tenant's charge leaves the added line.
    const removeCharge: ProjectForecastEdit = { ...removeAdded, id: "e-off-kim", row_key: "rec:income:c-kim" };
    expect(rentKeys([...added, removeCharge])).toEqual(["rec:income:c-ortiz", "add:e-rent-2"]);
  });
});
