import { describe, expect, it } from "vitest";
import { netIn, orderActiveProjects, overheadRow, projectMeta } from "../project-list";
import { sampleBoardCashMonths } from "./cash-sample";
import { devProjectsCash } from "./projects-sample";

const NOW = new Date(2026, 9, 11, 12);

/**
 * FLOW-445: the list's rows, the general-expenses row and the unassigned line make the month's net the
 * board draws (−$16,367.64). The board's Home frame shows −$17,192.00 for the same month: the two frames do
 * not reconcile (logged), so Home is pinned apart rather than forced to match.
 */
describe("projects list sample", () => {
  it("adds up to the board's month net, and Home's sample stays a separate figure", () => {
    const base = devProjectsCash.base_currency;
    const projects = devProjectsCash.projects.reduce((sum, row) => sum + netIn(row.cash, base), 0);
    const unassigned = netIn(devProjectsCash.unassigned.cash, base);
    expect(projects + unassigned).toBe(-1_636_764);
    const home = sampleBoardCashMonths(NOW).months[0]?.by_currency.find((row) => row.currency === base);
    expect(home?.net_minor).toBe(-1_719_200n);
  });

  it("reads each row's own type and status, like the board", () => {
    const active = orderActiveProjects(devProjectsCash.projects, devProjectsCash.base_currency);
    expect(active.map((row) => projectMeta(row))).toEqual([
      "עבודת לקוח · תשלום 2 מתוך 4",
      "flip · בשיפוץ",
      "שיפוץ · לפני השכרה",
      "השכרה · מושכר",
      "דופלקס להשכרה · 2 יחידות",
      "תיקון גג · חשבונית פתוחה",
      "מטבח · עבודת לקוח",
    ]);
    expect(overheadRow(devProjectsCash)?.name).toBe("משרד החברה / תקורה");
  });
});
