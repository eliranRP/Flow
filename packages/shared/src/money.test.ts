import { describe, expect, it } from "vitest";
import { allocateByWeights, divHalfEven, netFromGrossAgorot, shareBp } from "./money.ts";

describe("divHalfEven", () => {
  it("rounds a tie to the even quotient", () => {
    expect(divHalfEven(1n, 2n)).toBe(0n);
    expect(divHalfEven(3n, 2n)).toBe(2n);
    expect(divHalfEven(5n, 2n)).toBe(2n);
    expect(divHalfEven(7n, 2n)).toBe(4n);
  });

  it("rounds a non-tie away from the nearer side", () => {
    expect(divHalfEven(2n, 3n)).toBe(1n);
    expect(divHalfEven(1n, 3n)).toBe(0n);
  });
});

describe("netFromGrossAgorot", () => {
  it("divides a VAT-registered gross by 1.18", () => {
    expect(netFromGrossAgorot(2_596_000n, false)).toBe(2_200_000n);
  });

  it("keeps the gross amount for a VAT-exempt supplier", () => {
    expect(netFromGrossAgorot(960_000n, true)).toBe(960_000n);
  });

  it("preserves a credit sign", () => {
    expect(netFromGrossAgorot(-118_000n, false)).toBe(-100_000n);
  });
});

describe("allocateByWeights", () => {
  it("splits worker-days without losing an agora", () => {
    const parts = allocateByWeights(1_600_000n, [8, 24, 8]);
    expect(parts).toEqual([320_000n, 960_000n, 320_000n]);
    expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(1_600_000n);
  });

  it("emits basis points that sum to 10000", () => {
    const shares = shareBp([10, 12, 8, 6, 4]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(10000);
  });
});
