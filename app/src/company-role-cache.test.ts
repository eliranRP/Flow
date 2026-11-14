import { describe, expect, it } from "vitest";
import { BOOKS_CLOSED_MS, booksClosedNote, booksClosedSettingNote } from "./company-role-cache";

describe("booksClosedNote", () => {
  it("stays 8s, long enough to read its instruction (FLOW-1176)", () => {
    expect(BOOKS_CLOSED_MS).toBe(8000);
  });

  it("names the closed date as the toasts show a date, and says how to reopen it", () => {
    expect(booksClosedNote("2026-10-31")).toBe("הספרים סגורים עד 31/10/2026. כדי לשנות שורה מהתקופה הזו, הזיזו אחורה את תאריך הסגירה דרך עוזר ה־AI.");
  });
});

describe("booksClosedSettingNote (FLOW-1170)", () => {
  it("says the setting changes the closed books, with the date as the line's note shows it", () => {
    expect(booksClosedSettingNote("2026-10-31")).toBe("הספרים סגורים עד 31/10/2026, וההגדרה הזו משנה אותם. כדי לשנות, הזיזו אחורה את תאריך הסגירה דרך עוזר ה־AI.");
  });
});
