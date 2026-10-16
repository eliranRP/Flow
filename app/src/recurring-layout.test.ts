import { describe, expect, it } from "vitest";
import { compareInGroup, groupRecurring, monthlyCostMinor, monthOutflow, NO_CATEGORY, type RecurringLine } from "./recurring-layout";

/** The board's fixture (invented names, the board's amounts): the card and group figures must match. */
const line = (over: Partial<RecurringLine> & Pick<RecurringLine, "id">): RecurringLine => ({
  income: false,
  category: "חשמל ומים",
  pace: "month",
  minor: 0n,
  arrived: false,
  due: true,
  day: 1,
  ...over,
});

const BOARD: RecurringLine[] = [
  line({ id: "power", category: "חשמל ומים", minor: 18600n, day: 3 }),
  line({ id: "water", category: "חשמל ומים", minor: 14200n, arrived: true, day: 5 }),
  line({ id: "hoa", category: "אחזקה", minor: 31000n, day: 15 }),
  line({ id: "waste", category: "אחזקה", minor: 8800n, day: 25 }),
  line({ id: "pest", category: "אחזקה", minor: 6500n, arrived: true, day: 2 }),
  line({ id: "lawn", category: "אחזקה", pace: "2months", minor: 12000n, due: false, day: 12 }),
  line({ id: "insurance", category: "ביטוח ומסים", minor: 21200n, day: 20 }),
  line({ id: "property-tax", category: "ביטוח ומסים", pace: "year", minor: 342000n, due: false, day: 30 }),
  line({ id: "rent-a", category: "שכירות", income: true, minor: 165000n, arrived: true, day: 1 }),
  line({ id: "rent-b", category: "שכירות", income: true, minor: 210000n, arrived: true, day: 1 }),
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
  it("adds the arrived expenses at their amount and the due ones at their usual amount", () => {
    const out = monthOutflow(BOARD);
    // Arrived: water 142, pest 65. Due, not arrived: power 186, hoa 310, waste 88, insurance 212.
    expect(out.paid).toBe(20700n);
    expect(out.toCome).toBe(79600n);
    expect(out.total).toBe(out.paid + out.toCome);
  });

  it("leaves out income and charges not due this month", () => {
    const out = monthOutflow([
      line({ id: "in", income: true, minor: 100000n, due: true }),
      line({ id: "later", minor: 50000n, due: false }),
    ]);
    expect(out.total).toBe(0n);
  });
});

describe("compareInGroup", () => {
  it("puts paid first, then still to come, then later, each by day", () => {
    const ordered = [
      line({ id: "later", due: false, day: 1 }),
      line({ id: "due-late", day: 20 }),
      line({ id: "due-early", day: 2 }),
      line({ id: "paid", arrived: true, day: 28 }),
    ].sort(compareInGroup);
    expect(ordered.map((row) => row.id)).toEqual(["paid", "due-early", "due-late", "later"]);
  });
});

describe("groupRecurring", () => {
  const groups = groupRecurring(BOARD);

  it("puts income last and the expenses in the order they first appear", () => {
    expect(groups.map((group) => group.name)).toEqual(["חשמל ומים", "אחזקה", "ביטוח ומסים", "שכירות"]);
    expect(groups.at(-1)?.income).toBe(true);
  });

  it("sums each group as a monthly cost, so an every-two-months charge counts half", () => {
    const monthly = Object.fromEntries(groups.map((group) => [group.name, group.monthlyMinor]));
    expect(monthly["חשמל ומים"]).toBe(32800n);
    // 310 + 88 + 65 + 60 (the every-two-months lawn charge) in dollars.
    expect(monthly["אחזקה"]).toBe(52300n);
    // 212 + 285 (a yearly tax of 3,420 ÷ 12) in dollars.
    expect(monthly["ביטוח ומסים"]).toBe(49700n);
    expect(monthly["שכירות"]).toBe(375000n);
  });

  it("puts charges with no category last among the expenses, before income", () => {
    const withNone = groupRecurring([...BOARD, line({ id: "none", category: null, minor: 100n })]);
    expect(withNone.map((group) => group.name)).toEqual(["חשמל ומים", "אחזקה", "ביטוח ומסים", NO_CATEGORY, "שכירות"]);
  });
});
