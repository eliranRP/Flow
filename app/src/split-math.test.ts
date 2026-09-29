import { describe, expect, it } from "vitest";
import { allocate, basisToPercents, bpToPercent, evenBasis, incomeBasis, percentToBp, splitIsValid, summaryKind } from "./split-math";

describe("split math", () => {
  it("round-trips percents that have to sum to 10000", () => {
    expect(percentToBp("100")).toBe(10000);
    expect(percentToBp("33.33")).toBe(3333);
    expect(percentToBp("33.34")).toBe(3334);
    expect(percentToBp("12.5")).toBe(1250);
    expect(percentToBp("33.3")).toBe(3330);
    expect(percentToBp("")).toBe(0);
    expect(percentToBp(".")).toBe(0);
    const basis = evenBasis(["a", "b", "c"]);
    expect(basis).toEqual({ a: 3333, b: 3333, c: 3334 });
    const typed = basisToPercents(["a", "b", "c"], basis);
    expect(typed).toEqual({ a: "33.3", b: "33.3", c: "33.4" });
    expect(Object.values(typed).reduce((sum, raw) => sum + percentToBp(raw), 0)).toBe(10000);
    expect(bpToPercent(10000)).toBe("100");
  });

  it("puts leftover agorot on the first share so the parts equal the amount", () => {
    const parts = allocate(1001n, [
      { id: "a", bp: 3333 },
      { id: "b", bp: 3333 },
      { id: "c", bp: 3334 },
    ]);
    expect(parts.map((part) => part.agorot)).toEqual([333n, 333n, 335n]);
    expect(parts.reduce((sum, part) => sum + part.agorot, 0n)).toBe(1001n);
    expect(splitIsValid(parts)).toBe(true);
    expect(summaryKind("equal", parts)).toEqual({
      kind: "mixed",
      groups: [
        { agorot: 333n, count: 2 },
        { agorot: 335n, count: 1 },
      ],
    });
  });

  it("splits income by weight and names an even pair as each", () => {
    const basis = incomeBasis([
      { id: "a", name: "א", incomeAgorot: 3_000n },
      { id: "b", name: "ב", incomeAgorot: 1_000n },
      { id: "c", name: "ג", incomeAgorot: 1_000n },
    ]);
    expect(basis).toEqual({ a: 6000, b: 2000, c: 2000 });
    const even = allocate(100_000n, [
      { id: "a", bp: 5000 },
      { id: "b", bp: 5000 },
    ]);
    expect(summaryKind("equal", even)).toEqual({ kind: "each", agorot: 50_000n, count: 2 });
    expect(summaryKind("income", allocate(1001n, Object.entries(basis).map(([id, bp]) => ({ id, bp }))))).toEqual({
      kind: "income",
      count: 3,
    });
  });

  it("rejects a partial manual split and a split with nobody chosen", () => {
    expect(splitIsValid(allocate(10_000n, [{ id: "a", bp: 4000 }]))).toBe(false);
    expect(splitIsValid(allocate(10_000n, []))).toBe(false);
    expect(incomeBasis([{ id: "a", name: "א", incomeAgorot: 0n }])).toEqual({ a: 10000 });
  });
});
