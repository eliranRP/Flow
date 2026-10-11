// @vitest-environment node
import { describe, expect, it } from "vitest";
import { allocate, evenBasis, incomeBasis } from "./split-math";

describe("split math", () => {
  it("spreads an even split so the basis points sum to 10000", () => {
    expect(evenBasis(["a", "b", "c"])).toEqual({ a: 3333, b: 3333, c: 3334 });
  });

  it("puts leftover agorot on the last share so the parts equal the amount", () => {
    const parts = allocate(1001n, [
      { id: "a", bp: 3333 },
      { id: "b", bp: 3333 },
      { id: "c", bp: 3334 },
    ]);
    expect(parts.map((part) => part.agorot)).toEqual([333n, 333n, 335n]);
    expect(parts.reduce((sum, part) => sum + part.agorot, 0n)).toBe(1001n);
  });

  it("splits income by weight", () => {
    const basis = incomeBasis([
      { id: "a", name: "א", incomeAgorot: 3_000n },
      { id: "b", name: "ב", incomeAgorot: 1_000n },
      { id: "c", name: "ג", incomeAgorot: 1_000n },
    ]);
    expect(basis).toEqual({ a: 6000, b: 2000, c: 2000 });
  });

  it("shows each row as its own percent when the total is not 100%", () => {
    const amount = 100_000n;
    expect(allocate(amount, [
      { id: "a", bp: 7000 },
      { id: "b", bp: 5000 },
    ]).map((part) => part.agorot)).toEqual([70_000n, 50_000n]);
    expect(allocate(amount, [
      { id: "a", bp: 7000 },
      { id: "b", bp: 500 },
    ]).map((part) => part.agorot)).toEqual([70_000n, 5_000n]);
    expect(allocate(amount, [
      { id: "a", bp: 10000 },
      { id: "b", bp: 3000 },
      { id: "c", bp: 2000 },
      { id: "d", bp: 1000 },
    ]).map((part) => part.agorot)).toEqual([100_000n, 30_000n, 20_000n, 10_000n]);
    expect(allocate(amount, [
      { id: "a", bp: 15000 },
      { id: "b", bp: 3000 },
      { id: "c", bp: 2000 },
      { id: "d", bp: 1000 },
    ]).map((part) => part.agorot)).toEqual([150_000n, 30_000n, 20_000n, 10_000n]);
  });

  it("gives a lone project with no income the whole split", () => {
    expect(incomeBasis([{ id: "a", name: "א", incomeAgorot: 0n }])).toEqual({ a: 10000 });
  });
});
