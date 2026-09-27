/** Standard Israeli VAT, in basis points. Decision 0043. */
export const STANDARD_VAT_RATE_BP = 1800;

const VAT_DENOMINATOR = 118n;
const VAT_NUMERATOR = 100n;

/**
 * Half-to-even division of a non-negative integer.
 * `numerator / denominator`, with a tie rounded to the even quotient.
 */
export function divHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("denominator must be positive");
  }
  if (numerator < 0n) {
    throw new Error("numerator must be non-negative");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice < denominator) return quotient;
  if (twice > denominator) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

/** Shekels (possibly fractional in a source file) to integer agorot. */
export function shekelsToAgorot(shekels: number): bigint {
  if (!Number.isFinite(shekels)) {
    throw new Error("shekels must be finite");
  }
  return BigInt(Math.round(shekels * 100));
}

export function agorotToShekels(agorot: bigint): number {
  return Number(agorot) / 100;
}

/**
 * Net of VAT in agorot.
 * Exempt suppliers keep the gross amount. Everyone else uses
 * net = gross / 1.18, rounded half-to-even to the agora (decision 0043).
 * The sign of `grossAgorot` is preserved.
 */
export function netFromGrossAgorot(grossAgorot: bigint, vatExempt: boolean): bigint {
  const negative = grossAgorot < 0n;
  const abs = negative ? -grossAgorot : grossAgorot;
  const net = vatExempt ? abs : divHalfEven(abs * VAT_NUMERATOR, VAT_DENOMINATOR);
  return negative ? -net : net;
}

export function vatFromGrossAndNet(grossAgorot: bigint, netAgorot: bigint): bigint {
  return grossAgorot - netAgorot;
}

/**
 * Split `total` across `weights` in integer units. Remainders go to the
 * largest fractional parts, then to the earliest index, so the parts sum
 * back to `total`.
 */
export function allocateByWeights(total: bigint, weights: readonly number[]): bigint[] {
  if (weights.length === 0) return [];
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 0)) {
    throw new Error("weights must be non-negative integers");
  }
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) {
    throw new Error("weights must sum to a positive number");
  }
  const negative = total < 0n;
  const abs = negative ? -total : total;
  const sum = BigInt(weightSum);
  const base = weights.map((weight) => (abs * BigInt(weight)) / sum);
  let assigned = base.reduce((sumAgorot, part) => sumAgorot + part, 0n);
  let leftover = abs - assigned;
  const ranked = weights
    .map((weight, index) => ({
      index,
      remainder: (abs * BigInt(weight)) % sum,
    }))
    .sort((a, b) => {
      if (a.remainder === b.remainder) return a.index - b.index;
      return a.remainder > b.remainder ? -1 : 1;
    });
  for (const entry of ranked) {
    if (leftover === 0n) break;
    base[entry.index] = (base[entry.index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  assigned = base.reduce((sumAgorot, part) => sumAgorot + part, 0n);
  if (assigned !== abs) {
    throw new Error("allocation did not consume the total");
  }
  return negative ? base.map((part) => -part) : base;
}

/** Basis points (0–10000) for the same weights. Parts sum to 10000. */
export function shareBp(weights: readonly number[]): number[] {
  const parts = allocateByWeights(10000n, weights);
  return parts.map((part) => Number(part));
}
