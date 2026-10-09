import { describe, expect, it } from "vitest";
import { sampleBreakdown, sampleBreakdownLines } from "./breakdown-sample";

/** FLOW-334: the review cycle's breakdown sample adds up, so its shots never show figures that disagree. */
describe("breakdown sample", () => {
  for (const direction of ["expense", "income"] as const) {
    for (const groupBy of ["category", "project", "payer"] as const) {
      it(`${direction} by ${groupBy}: the total is its groups, and a group's lines are its amount`, () => {
        const sample = sampleBreakdown(direction, groupBy);
        const groups = sample.groups.reduce((sum, group) => sum + group.amount_minor, 0n);
        expect(sample.totals[0]?.amount_minor).toBe(groups);
        for (const group of sample.groups) {
          const lines = sampleBreakdownLines(sample, group.key, false)?.rows ?? [];
          expect(lines.reduce((sum, row) => sum + row.amount_minor, 0n)).toBe(group.amount_minor);
        }
      });
    }
  }

  it("the lines kept out add up to the kept-out figure", () => {
    const sample = sampleBreakdown("expense", "category");
    const lines = sampleBreakdownLines(sample, "", true)?.rows ?? [];
    expect(lines.reduce((sum, row) => sum + row.amount_minor, 0n)).toBe(sample.excluded[0]?.amount_minor);
  });
});
