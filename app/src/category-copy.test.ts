import { describe, expect, it } from "vitest";
import { mergeFailureText, pnlFailureText } from "./category-copy";

describe("category write refusals (FLOW-134)", () => {
  it("says why a loan's category keeps its P&L state", () => {
    expect(pnlFailureText(new Error("loan category is fixed"))).toBe("הלוואה משתמשת בקטגוריה הזו, ולכן אי אפשר לשנות אם היא ברווח והפסד.");
    expect(pnlFailureText(new Error("category not found"))).toBe("לא הצלחנו לעדכן את הקטגוריה.");
  });

  it("names merge_category's refusals", () => {
    expect(mergeFailureText(new Error("a loan uses this category for a part the other category cannot take"))).toBe(
      "הלוואה משתמשת בקטגוריה הזו לחלק שהקטגוריה השנייה לא יכולה לקבל.",
    );
    expect(mergeFailureText(new Error("a split line has both categories"))).toBe("שורה מפוצלת משתמשת בשתי הקטגוריות.");
    expect(mergeFailureText(new Error("no company"))).toBe("לא הצלחנו למזג.");
  });
});
