// @vitest-environment node
import { describe, expect, it } from "vitest";
import { overheadHint } from "./overhead";

describe("overhead view", () => {
  it("keeps the stored profit while the switch is off", () => {
    expect(overheadHint(false, { available: true, shareAgorot: 4_000_000n })).toBeUndefined();
  });

  it("shows profit after the income share, and says what the share is", () => {
    expect(overheadHint(true, { available: true, shareAgorot: 4_000_000n })).toBe("החלק בהוצאות כלליות ₪40,000");
    expect(overheadHint(true, { available: false })).toBe("אין הכנסות בפרויקטים, אז אי אפשר לחלק את ההוצאות הכלליות");
    expect(overheadHint(true, { available: true, shareAgorot: 250_000n, currency: "USD" })).toBe("החלק בהוצאות כלליות $2,500");
    expect(overheadHint(true, { available: true, scope: "company" })).toBe("כל פרויקט מציג רווח אחרי חלקו בהוצאות הכלליות");
  });
});
