import { describe, expect, it } from "vitest";
import { mercuryRefreshDone } from "./mercury-copy";

describe("mercuryRefreshDone (FLOW-509)", () => {
  it("counts the new lines after a run that read everything", () => {
    expect(mercuryRefreshDone({ complete: true, inserted: 0 })).toBe("הרענון הסתיים. אין תנועות חדשות.");
    expect(mercuryRefreshDone({ complete: true, inserted: 1 })).toBe("הרענון הסתיים. תנועה חדשה אחת.");
    expect(mercuryRefreshDone({ complete: true, inserted: 12 })).toBe("הרענון הסתיים. 12 תנועות חדשות.");
  });

  it("keeps the plain sentence when the run stopped early or sent no count", () => {
    expect(mercuryRefreshDone({ complete: false, inserted: 4 })).toBe("הרענון הסתיים.");
    expect(mercuryRefreshDone({ ok: true, lines: 2, inserted: 2 })).toBe("הרענון הסתיים.");
    expect(mercuryRefreshDone({ complete: true, inserted: -1 })).toBe("הרענון הסתיים.");
    expect(mercuryRefreshDone({ complete: true, inserted: "3" })).toBe("הרענון הסתיים.");
    expect(mercuryRefreshDone(null)).toBe("הרענון הסתיים.");
    expect(mercuryRefreshDone(undefined)).toBe("הרענון הסתיים.");
  });
});
