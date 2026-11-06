import { describe, expect, it } from "vitest";
import { skipEdits } from "./company-next-month";
import { applyForecastEdits, type NextMonthForecast, type ProjectForecastEdit } from "./project-next-month";
import { overrideKeyFor } from "./screens/project-next-skipped";

// FLOW-1079: a month's skips become one-month removals of the part's recurring rows.
describe("skipEdits", () => {
  const keys = ["party:expense:power:USD", "party:income:rent:USD:p2", "party:expense:hoa:USD:none", "invoice:abc"];

  it("takes a party's row out of every part, and a project's only out of its own", () => {
    expect(skipEdits(keys, "p1", "oh", "2027-01").map((edit) => edit.row_key)).toEqual(["rec:expense:power"]);
    expect(skipEdits(keys, "p2", "oh", "2027-01").map((edit) => edit.row_key)).toEqual(["rec:expense:power", "rec:income:rent"]);
  });

  it("gives the general costs the charges with no project or the overhead project's", () => {
    expect(skipEdits(keys, null, "oh", "2027-01").map((edit) => edit.row_key)).toEqual(["rec:expense:power", "rec:expense:hoa"]);
    expect(skipEdits(["party:expense:tax:USD:oh"], null, "oh", "2027-01")).toHaveLength(1);
  });

  it("holds for its month only", () => {
    expect(skipEdits(keys, "p1", null, "2027-01")[0]).toMatchObject({ kind: "remove", pace: "once", start_month: "2027-01", id: "skip:party:expense:power:USD" });
    expect(skipEdits(undefined, "p1", null, "2027-01")).toEqual([]);
  });
});

// FLOW-1079 r2: a skip's row is listed apart from the project page's own removals, so its way back is the month
// forecast's item, not restore_project_forecast_row.
describe("applyForecastEdits with skips", () => {
  const base: NextMonthForecast = {
    month: "2027-01",
    rows: [
      { key: "rec:expense:power", kind: "recurring", direction: "expense", name: "Brightline Power", date: null, minor: -18_600n, categoryId: null, wasMinor: null, pace: null },
      { key: "rec:expense:hoa", kind: "recurring", direction: "expense", name: "Juniper Pointe HOA", date: null, minor: -31_000n, categoryId: null, wasMinor: null, pace: null },
    ],
    incomeMinor: 0n,
    expenseMinor: 49_600n,
    netMinor: -49_600n,
    loanCount: 0,
    averageMonths: 6,
    loanCash: [],
    cashOnlyMinor: 0n,
    removed: [],
    arrived: [],
  };
  const pageRemoval: ProjectForecastEdit = { id: "e1", kind: "remove", row_key: "rec:expense:hoa", category_id: null, direction: null, amount_minor: null, pace: "month", start_month: "2027-01" };

  it("lists a skipped row under skipped, leaves the page's removal under removed, and counts neither", () => {
    const out = applyForecastEdits(base, [pageRemoval, ...skipEdits(["party:expense:power:USD"], "p1", null, "2027-01")]);
    expect(out.removed.map((row) => row.key)).toEqual(["rec:expense:hoa"]);
    expect(out.skipped?.map((row) => row.key)).toEqual(["rec:expense:power"]);
    expect(out.expenseMinor).toBe(0n);
  });

  it("keeps a row both took out as the page's removal", () => {
    const out = applyForecastEdits(base, [pageRemoval, ...skipEdits(["party:expense:hoa:USD"], "p1", null, "2027-01")]);
    expect(out.removed.map((row) => row.key)).toEqual(["rec:expense:hoa"]);
    expect(out.skipped).toEqual([]);
  });
});

describe("overrideKeyFor", () => {
  const off = (item_key: string, moved_out = true) => ({ item_key, amount_minor: null, due_on: null, moved_out });

  it("finds this page's own moved-out item, never another project's (a split party, both skipped)", () => {
    const overrides = [off("party:expense:power:USD:p2"), off("party:expense:power:USD:p1")];
    expect(overrideKeyFor("rec:expense:power", overrides, "p1", "USD", false)).toBe("party:expense:power:USD:p1");
    expect(overrideKeyFor("rec:expense:power", overrides, "p2", "USD", false)).toBe("party:expense:power:USD:p2");
    expect(overrideKeyFor("rec:expense:power", overrides, "p3", "USD", false)).toBeNull();
  });

  it("falls back to the party's plain key in the page's currency, and :none on the general costs' page only", () => {
    expect(overrideKeyFor("rec:expense:power", [off("party:expense:power:USD")], "p1", "USD", false)).toBe("party:expense:power:USD");
    expect(overrideKeyFor("rec:expense:power", [off("party:expense:power:EUR")], "p1", "USD", false)).toBeNull();
    expect(overrideKeyFor("rec:expense:hoa", [off("party:expense:hoa:USD:none")], "oh", "USD", true)).toBe("party:expense:hoa:USD:none");
    expect(overrideKeyFor("rec:expense:hoa", [off("party:expense:hoa:USD:none")], "p1", "USD", false)).toBeNull();
  });

  it("ignores an item only changed, and a row that is not a charge", () => {
    expect(overrideKeyFor("rec:expense:hoa", [off("party:expense:hoa:USD", false)], "p1", "USD", false)).toBeNull();
    expect(overrideKeyFor("avg:cat", [off("party:expense:hoa:USD")], "p1", "USD", false)).toBeNull();
  });
});
