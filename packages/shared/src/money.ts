/** Standard Israeli VAT, in basis points. Decision 0043. The only rate constant. */
export const STANDARD_VAT_RATE_BP = 1800;

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

function numberToDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("shekels must be finite");
  }
  const text = Object.is(value, -0) ? "0" : value.toString();
  if (!/[eE]/.test(text)) return text;
  return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Parse a decimal string to an integer at `scale` digits, half-to-even.
 * Scale 2 is agorot. Scale 4 turns a fraction such as 0.18 into 1800 bp.
 */
export function parseDecimalHalfEven(text: string, scale: number): bigint {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const body = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  if (!/^\d+(\.\d+)?$/.test(body)) {
    throw new Error(`invalid decimal: ${text}`);
  }
  const [whole = "0", frac = ""] = body.split(".");
  const digits = (frac + "0".repeat(scale + 1)).slice(0, scale + 1);
  const kept = digits.slice(0, scale);
  const guard = digits[scale] ?? "0";
  const rest = frac.slice(scale + 1);
  const factor = 10n ** BigInt(scale);
  let scaled = BigInt(whole) * factor + BigInt(kept.length === 0 ? "0" : kept);
  const guardDigit = Number(guard);
  const more = /[1-9]/.test(rest);
  const tie = guardDigit === 5 && !more;
  const roundUp = guardDigit > 5 || (guardDigit === 5 && more) || (tie && scaled % 2n === 1n);
  if (roundUp) scaled += 1n;
  return negative ? -scaled : scaled;
}

/** Strip grouping commas and spaces, then parse shekels to agorot. */
export function parseShekelInput(text: string): bigint {
  return parseDecimalHalfEven(text.trim().replace(/[\s,]/g, ""), 2);
}

/** Shekels, as a decimal string or a JSON number, to integer agorot. */
export function shekelsToAgorot(shekels: number | string): bigint {
  const text = typeof shekels === "string" ? shekels : numberToDecimal(shekels);
  return parseShekelInput(text);
}

/** A VAT fraction such as 0.18 to basis points (1800). */
export function rateFractionToBp(rate: number): number {
  const bp = parseDecimalHalfEven(numberToDecimal(rate), 4);
  if (bp < 0n || bp > 10000n) {
    throw new Error("VAT rate is out of range");
  }
  return Number(bp);
}

export function agorotToShekels(agorot: bigint): number {
  return Number(agorot) / 100;
}

/** Nearest whole shekel, half-to-even. Display rounding lives here, not in the totals. */
export function wholeShekels(agorot: bigint): number {
  const negative = agorot < 0n;
  const abs = negative ? -agorot : agorot;
  const shekels = divHalfEven(abs, 100n);
  return Number(negative ? -shekels : shekels);
}

/**
 * Visible profit is rounded income minus rounded expenses.
 * Rounding each side on its own, then subtracting the raw net, does not add up.
 */
export function roundedProfitAgorot(incomeAgorot: bigint, expenseAgorot: bigint): bigint {
  return BigInt(wholeShekels(incomeAgorot) - wholeShekels(expenseAgorot)) * 100n;
}

/**
 * ₪ before the digits, thousands commas, Unicode minus.
 * Summaries are whole shekels. `{ agorot: true }` keeps a non-zero agora remainder.
 * Decision 0016 and the implementation guide §6.4.
 */
/**
 * Minor units in the line's own currency.
 * ILS uses ₪. USD uses $. Any other code is written before the digits.
 * Two-decimal currencies share the shekel rounding. Summaries are whole units.
 */
export function formatMoney(minor: bigint, currency = "ILS", options?: { agorot?: boolean }): string {
  if (currency === "" || currency === "ILS") return formatIls(minor, options);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const sign = negative ? "−" : "";
  const prefix = currency === "USD" ? "$" : `${currency} `;
  if (options?.agorot && abs % 100n !== 0n) {
    const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = (abs % 100n).toString().padStart(2, "0");
    return `${sign}${prefix}${whole}.${fraction}`;
  }
  const major = wholeShekels(abs);
  if (major === 0) return `${prefix}0`;
  const digits = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${prefix}${digits}`;
}

export function formatUsd(minor: bigint, options?: { agorot?: boolean }): string {
  return formatMoney(minor, "USD", options);
}

export function formatIls(agorot: bigint, options?: { agorot?: boolean }): string {
  const negative = agorot < 0n;
  const abs = negative ? -agorot : agorot;
  const sign = negative ? "−" : "";
  if (options?.agorot && abs % 100n !== 0n) {
    const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const agora = (abs % 100n).toString().padStart(2, "0");
    return `${sign}₪${whole}.${agora}`;
  }
  const shekels = wholeShekels(abs);
  if (shekels === 0) return "₪0";
  const digits = shekels.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₪${digits}`;
}

/**
 * Net of VAT in agorot.
 * `rateBp` 0 keeps the gross amount (VAT-exempt). 1800 is net = gross / 1.18.
 * The sign of `grossAgorot` is preserved. Decision 0043.
 */
export function netFromGrossAgorot(grossAgorot: bigint, rateBp: number): bigint {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) {
    throw new Error("rateBp must be an integer from 0 to 10000");
  }
  if (rateBp === 0) return grossAgorot;
  const negative = grossAgorot < 0n;
  const abs = negative ? -grossAgorot : grossAgorot;
  const net = divHalfEven(abs * 10000n, BigInt(10000 + rateBp));
  return negative ? -net : net;
}

export function vatFromGrossAndNet(grossAgorot: bigint, netAgorot: bigint): bigint {
  return grossAgorot - netAgorot;
}

/**
 * Split `total` across `weights` in integer units. Remainders go to the
 * largest fractional parts, then to the earliest index, so the parts sum
 * back to `total`. The sign of `total` is preserved.
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
    const current = base[entry.index] ?? 0n;
    base[entry.index] = current + 1n;
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
