import { describe, expect, it } from "vitest";
import { retryClock } from "./sumit-copy";

const now = Date.parse("2026-09-28T20:00:00.000Z");

describe("retryClock", () => {
  it("stays silent for an empty or past time", () => {
    expect(retryClock(null, now)).toBeNull();
    expect(retryClock("2026-09-28T19:00:00.000Z", now)).toBeNull();
  });

  it("prints the Israel clock, and מחר when that date is the next day", () => {
    expect(retryClock("2026-09-28T20:30:00.000Z", now)).toBe("אפשר לנסות שוב ב-23:30");
    expect(retryClock("2026-09-28T21:30:00.000Z", now)).toBe("אפשר לנסות שוב מחר ב-00:30");
  });
});
