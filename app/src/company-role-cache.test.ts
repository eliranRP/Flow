import { describe, expect, it } from "vitest";
import { booksClosedNote } from "./company-role-cache";

describe("booksClosedNote", () => {
  it("names the closed date as the toasts show a date, and says how to reopen it", () => {
    expect(booksClosedNote("2026-10-31")).toBe("הספרים סגורים עד 31/10/2026. כדי לשנות שורה מהתקופה הזו, הזיזו אחורה את תאריך הסגירה דרך עוזר ה־AI.");
  });
});
