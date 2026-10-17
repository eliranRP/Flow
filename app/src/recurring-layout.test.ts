import { describe, expect, it } from "vitest";
import { compareInGroup, groupRecurring, monthlyCostMinor, monthOutflow, NO_CATEGORY, type RecurringLine } from "./recurring-layout";

/** One charge of the rule-25 fixture (invented names; amounts in cents). */
const line = (over: Partial<RecurringLine> & Pick<RecurringLine, "id" | "usual">): RecurringLine => ({
  income: false,
  category: "חשמל ומים",
  pace: "month",
  minor: over.usual,
  arrived: false,
  due: true,
  day: 1,
  ...over,
});

/** The brief's fixture, in its order: 15 charges, today 2026-10-11. Arrived rows carry the amount they came at. */
const BOARD: RecurringLine[] = [
  line({ id: "power", category: "חשמל ומים", usual: 18600n, day: 3 }),
  line({ id: "rent-elm", category: "שכירות", income: true, usual: 165000n, day: 1 }),
  line({ id: "hoa", category: "אחזקה", usual: 31000n, day: 15 }),
  line({ id: "internet", category: "משרד", usual: 13000n, day: 18 }),
  line({ id: "insurance", category: "ביטוח ומסים", usual: 21200n, day: 20 }),
  line({ id: "waste", category: "אחזקה", usual: 8800n, day: 25 }),
  line({ id: "software", category: "משרד", usual: 3600n, day: 28 }),
  line({ id: "water", category: "חשמל ומים", usual: 10300n, minor: 14200n, arrived: true, due: true, day: 5 }),
  line({ id: "phone", category: "משרד", usual: 8400n, minor: 8400n, arrived: true, day: 6 }),
  line({ id: "pest", category: "אחזקה", usual: 6500n, minor: 6500n, arrived: true, day: 2 }),
  line({ id: "rent-birch", category: "שכירות", income: true, usual: 210000n, minor: 210000n, arrived: true, day: 1 }),
  line({ id: "rent-juniper", category: "שכירות", income: true, usual: 185000n, minor: 185000n, arrived: true, day: 1 }),
  line({ id: "lawn", category: "אחזקה", pace: "2months", usual: 12000n, due: false, day: 12 }),
  line({ id: "pinecrest", category: "ביטוח ומסים", pace: "quarter", usual: 54000n, due: false, day: 10 }),
  line({ id: "property-tax", category: "ביטוח ומסים", pace: "year", usual: 342000n, due: false, day: 30 }),
];

describe("monthlyCostMinor", () => {
  it("divides by the months each payment covers", () => {
    expect(monthlyCostMinor(12000n, "month")).toBe(12000n);
    expect(monthlyCostMinor(12000n, "2months")).toBe(6000n);
    expect(monthlyCostMinor(54000n, "quarter")).toBe(18000n);
    expect(monthlyCostMinor(342000n, "year")).toBe(28500n);
  });

  it("rounds half up to a whole minor unit", () => {
    expect(monthlyCostMinor(1n, "2months")).toBe(1n);
    expect(monthlyCostMinor(10n, "quarter")).toBe(3n);
  });
});

describe("monthOutflow", () => {
  it("matches the board: $1,253 out, $291 paid, $962 still to come", () => {
    const out = monthOutflow(BOARD);
    // Arrived: water 142, phone 84, pest 65. Due, not arrived: power 186, hoa 310, internet 130, insurance 212, waste 88, software 36.
    expect(out.paid).toBe(29100n);
    expect(out.toCome).toBe(96200n);
    expect(out.total).toBe(125300n);
  });

  it("leaves out income and charges not due this month", () => {
    const out = monthOutflow([
      line({ id: "in", income: true, usual: 100000n }),
      line({ id: "later", usual: 50000n, due: false }),
    ]);
    expect(out.total).toBe(0n);
  });
});

describe("compareInGroup", () => {
  it("puts paid first, then still to come, then later, each by day", () => {
    const ordered = [
      line({ id: "later", usual: 1n, due: false, day: 1 }),
      line({ id: "due-late", usual: 1n, day: 20 }),
      line({ id: "due-early", usual: 1n, day: 2 }),
      line({ id: "paid", usual: 1n, arrived: true, day: 28 }),
    ].sort(compareInGroup);
    expect(ordered.map((row) => row.id)).toEqual(["paid", "due-early", "due-late", "later"]);
  });
});

describe("groupRecurring", () => {
  const groups = groupRecurring(BOARD);
  const monthly = Object.fromEntries(groups.map((group) => [group.name, group.monthlyMinor]));

  it("puts income last and each expense category in one group", () => {
    expect(groups.map((group) => group.name)).toEqual(["חשמל ומים", "אחזקה", "משרד", "ביטוח ומסים", "שכירות"]);
    expect(groups.at(-1)?.income).toBe(true);
  });

  it("sums each group at its usual amount, so an arrived charge counts as usual", () => {
    // Board: חשמל ומים $289 (water at its usual 103, not the 142 it came at).
    expect(monthly["חשמל ומים"]).toBe(28900n);
    // Board: אחזקה $523, with the every-two-months lawn charge counted as half.
    expect(monthly["אחזקה"]).toBe(52300n);
    // Board: משרד $250.
    expect(monthly["משרד"]).toBe(25000n);
    // Board: ביטוח ומסים $677, with the quarterly 540 counted as 180 and the yearly 3,420 as 285.
    expect(monthly["ביטוח ומסים"]).toBe(67700n);
    // Board: שכירות +$5,600 a month.
    expect(monthly["שכירות"]).toBe(560000n);
  });

  it("puts charges with no category last among the expenses, before income", () => {
    const withNone = groupRecurring([...BOARD, line({ id: "none", category: null, usual: 100n })]);
    expect(withNone.map((group) => group.name)).toEqual(["חשמל ומים", "אחזקה", "משרד", "ביטוח ומסים", NO_CATEGORY, "שכירות"]);
  });
});
