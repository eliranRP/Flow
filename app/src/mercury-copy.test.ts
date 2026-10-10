// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hebrewMercuryError, mercuryRefreshDone } from "./mercury-copy";

describe("mercuryRefreshDone (FLOW-509)", () => {
  it("counts the new lines after a run that read everything", () => {
    expect(mercuryRefreshDone({ complete: true, inserted: 0 })).toBe("אין תנועות חדשות");
    expect(mercuryRefreshDone({ complete: true, inserted: 1 })).toBe("תנועה חדשה אחת");
    expect(mercuryRefreshDone({ complete: true, inserted: 12 })).toBe("12 תנועות חדשות");
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

describe("hebrewMercuryError import date", () => {
  it("names a bad import date instead of the generic failure", () => {
    expect(hebrewMercuryError("import date is invalid")).toBe("תאריך הייבוא לא תקין. בחרו תאריך אחר.");
  });
});
