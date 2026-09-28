import { describe, expect, it } from "vitest";
import { overheadHint, shownProfit } from "./overhead";

describe("overhead view", () => {
  it("keeps the stored profit while the switch is off", () => {
    expect(shownProfit(false, 18_000_000n, 12_000_000n, 6_000_000n)).toBe(18_000_000n);
    expect(overheadHint(false, false)).toBe("כבוי · מציג רווח לפני כלליות");
  });

  it("shows the after-overhead figure, and says the share is zero until weights exist", () => {
    expect(shownProfit(true, 18_000_000n, 12_000_000n, 6_000_000n)).toBe(12_000_000n);
    expect(shownProfit(true, 18_000_000n, undefined, 0n)).toBe(18_000_000n);
    expect(overheadHint(true, false)).toBe("דלוק · אין עדיין משקלות, החלק בכלליות הוא ₪0");
    expect(overheadHint(true, true)).toBe("דלוק · מציג רווח אחרי כלליות");
  });
});
