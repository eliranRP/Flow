/**
 * Dollars on the wire to integer cents.
 * Mercury sends a JSON number. A string, an empty value, or null is refused.
 * The source is the number's decimal string. This does not multiply the
 * float by 100 and round. Exponent spelling and more than two decimal
 * places are refused.
 */
export function dollarsToCents(amount: unknown): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const text = Object.is(amount, -0) ? "0" : amount.toString();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const whole = match[2];
  const frac = match[3] ?? "";
  if (frac.length > 2) return null;
  if (!Number.isSafeInteger(Number(whole))) return null;
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return match[1] === "-" ? -cents : cents;
}
