import { describe, expect, it } from "vitest";
import {
  STANDARD_VAT_RATE_BP,
  allocateByWeights,
  divHalfEven,
  formatIls,
  netFromGrossAgorot,
  rateFractionToBp,
  shareBp,
  shekelsToAgorot,
} from "./money.ts";

describe("divHalfEven", () => {
  it("rounds a tie to the even quotient", () => {
    expect(divHalfEven(1n, 2n)).toBe(0n);
    expect(divHalfEven(3n, 2n)).toBe(2n);
    expect(divHalfEven(5n, 2n)).toBe(2n);
    expect(divHalfEven(7n, 2n)).toBe(4n);
  });

  it("rounds a non-tie toward the nearer integer", () => {
    expect(divHalfEven(2n, 3n)).toBe(1n);
    expect(divHalfEven(1n, 3n)).toBe(0n);
  });

  it("rejects a non-positive divisor and a negative numerator", () => {
    expect(() => divHalfEven(1n, 0n)).toThrow(/denominator/);
    expect(() => divHalfEven(1n, -2n)).toThrow(/denominator/);
    expect(() => divHalfEven(-1n, 2n)).toThrow(/numerator/);
  });
});

describe("shekelsToAgorot", () => {
  it("parses a decimal string with half-to-even agorot", () => {
    expect(shekelsToAgorot("1.005")).toBe(100n);
    expect(shekelsToAgorot("1.015")).toBe(102n);
    expect(shekelsToAgorot("25960")).toBe(2_596_000n);
    expect(shekelsToAgorot("-10.01")).toBe(-1001n);
  });

  it("does not use binary float times one hundred", () => {
    expect(shekelsToAgorot(1.005)).toBe(100n);
    expect(shekelsToAgorot(10.01)).toBe(1001n);
  });
});

describe("netFromGrossAgorot", () => {
  it("divides a VAT-registered gross by the given rate", () => {
    expect(netFromGrossAgorot(2_596_000n, STANDARD_VAT_RATE_BP)).toBe(2_200_000n);
    expect(rateFractionToBp(0.18)).toBe(STANDARD_VAT_RATE_BP);
  });

  it("keeps the gross amount when the rate is zero", () => {
    expect(netFromGrossAgorot(960_000n, 0)).toBe(960_000n);
  });

  it("preserves a credit sign", () => {
    expect(netFromGrossAgorot(-118_000n, STANDARD_VAT_RATE_BP)).toBe(-100_000n);
  });

  it("rounds a non-exact gross to agorot", () => {
    expect(netFromGrossAgorot(1001n, STANDARD_VAT_RATE_BP)).toBe(848n);
  });
});

describe("allocateByWeights", () => {
  it("splits worker-days without losing an agora", () => {
    const parts = allocateByWeights(1_600_000n, [8, 24, 8]);
    expect(parts).toEqual([320_000n, 960_000n, 320_000n]);
    expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(1_600_000n);
  });

  it("preserves a negative total", () => {
    expect(allocateByWeights(-100n, [1, 1])).toEqual([-50n, -50n]);
  });

  it("emits basis points that sum to 10000", () => {
    const shares = shareBp([10, 12, 8, 6, 4]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(10000);
  });
});

describe("formatIls", () => {
  it("puts the shekel sign before the digits", () => {
    expect(formatIls(20_000_000n)).toBe("₪200,000");
    expect(formatIls(-1_000_000n)).toBe("−₪10,000");
  });
});
