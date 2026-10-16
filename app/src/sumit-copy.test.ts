// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hebrewSumitError, israelSyncPhrase, israelUsePhrase, msUntilNextIsraelDay } from "./sumit-copy";

describe("israelSyncPhrase", () => {
  it("names today, yesterday, and an older day across midnight in Asia/Jerusalem", () => {
    const midnight = Date.parse("2026-10-03T21:05:00.000Z");
    expect(israelSyncPhrase("2026-10-03T21:02:00.000Z", midnight)).toBe("עודכן ב-00:02");
    expect(israelSyncPhrase("2026-10-03T20:50:00.000Z", midnight)).toBe("עודכן אתמול ב-23:50");
    expect(israelSyncPhrase("2026-09-30T11:05:00.000Z", midnight)).toBe("עודכן\u00A030/09");
    // FLOW-356: the investment card's dd/mm, with the year when it is another year's.
    expect(israelSyncPhrase("2025-12-30T11:05:00.000Z", midnight)).toBe("עודכן\u00A030/12/25");
    expect(israelSyncPhrase(null, midnight)).toBeNull();
  });
});

describe("israelUsePhrase", () => {
  it("uses the same today, yesterday, and older-day rules", () => {
    const midnight = Date.parse("2026-10-03T21:05:00.000Z");
    expect(israelUsePhrase("2026-10-03T21:02:00.000Z", midnight)).toBe("שימוש אחרון ב-00:02");
    expect(israelUsePhrase("2026-10-03T20:50:00.000Z", midnight)).toBe("שימוש אחרון אתמול ב-23:50");
    expect(israelUsePhrase("2026-09-30T11:05:00.000Z", midnight)).toBe("שימוש אחרון\u00A030/09");
    expect(israelUsePhrase(null, midnight)).toBeNull();
  });
});

describe("msUntilNextIsraelDay", () => {
  it("lands on the next Israel date", () => {
    const evening = Date.parse("2026-10-03T20:59:30.000Z");
    const wait = msUntilNextIsraelDay(evening);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThan(60 * 1000);
    const before = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(evening);
    const after = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(evening + wait);
    expect(after).not.toBe(before);
  });
});

describe("hebrewSumitError import date", () => {
  it("names a bad import date instead of the generic failure", () => {
    expect(hebrewSumitError("import date is invalid")).toBe("תאריך הייבוא לא תקין. בחרו תאריך אחר.");
  });
});
