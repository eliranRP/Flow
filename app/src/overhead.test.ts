import { describe, expect, it } from "vitest";
import { overheadHint, shownProfit } from "./overhead";

describe("overhead view", () => {
  it("keeps the stored profit while the switch is off", () => {
    expect(shownProfit(false, true, 10_000_000n, 6_000_000n)).toBe(10_000_000n);
    expect(overheadHint(false, { available: true, shareAgorot: 4_000_000n })).toBe("כבוי · מציג רווח לפני כלליות");
  });

  it("shows profit after the income share, and says so", () => {
    expect(shownProfit(true, true, 10_000_000n, 6_000_000n)).toBe(6_000_000n);
    expect(shownProfit(true, false, 10_000_000n, 6_000_000n)).toBe(10_000_000n);
    expect(overheadHint(true, { available: true, shareAgorot: 4_000_000n })).toBe("דלוק · החלק בכלליות הוא ₪40,000");
    expect(overheadHint(true, { available: false })).toBe("דלוק · אין הכנסות בפרויקטים, אז אי אפשר לחלק את הכלליות");
    expect(overheadHint(true, { available: true, scope: "company" })).toBe("דלוק · כל פרויקט מציג רווח אחרי חלקו בכלליות");
  });
});
