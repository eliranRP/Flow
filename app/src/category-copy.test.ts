import { describe, expect, it } from "vitest";
import {
  deleteConsequence,
  deletedToast,
  deleteFailureText,
  mergeFailureText,
  moveFailureText,
  movedToast,
  pnlFailureText,
  restoreFailureText,
  undoMoveFailureText,
} from "./category-copy";

describe("category write refusals (FLOW-134)", () => {
  it("says why a loan's category keeps its P&L state", () => {
    expect(pnlFailureText(new Error("loan category is fixed"))).toBe("זו קטגוריה של הלוואה, ולכן המצב שלה ברווח והפסד קבוע.");
    expect(pnlFailureText(new Error("category not found"))).toBe("לא הצלחנו לעדכן את הקטגוריה.");
  });

  it("names merge_category's refusals", () => {
    expect(mergeFailureText(new Error("a loan uses this category for a part the other category cannot take"))).toBe(
      "אי אפשר למזג: הלוואה משתמשת בקטגוריה הזו לחלק שהקטגוריה השנייה לא מתאימה לו.",
    );
    expect(mergeFailureText(new Error("a split line has both categories"))).toBe("אי אפשר למזג: שורה מפוצלת משתמשת בשתי הקטגוריות.");
    expect(mergeFailureText(new Error("no company"))).toBe("לא הצלחנו למזג.");
  });
});

describe("delete and move all lines (FLOW-405)", () => {
  it("counts the lines that go back to review", () => {
    expect(deleteConsequence(0)).toBe("אין בה תנועות.");
    expect(deleteConsequence(1)).toBe("תנועה אחת תחזור לאישור בלי קטגוריה.");
    expect(deleteConsequence(12)).toBe("12 תנועות יחזרו לאישור בלי קטגוריה.");
    expect(deletedToast("ציוד", 0)).toBe("ציוד נמחקה");
    expect(deletedToast("ציוד", 1)).toBe("ציוד נמחקה · תנועה אחת חזרה לאישור");
    expect(deletedToast("ציוד", 3)).toBe("ציוד נמחקה · 3 תנועות חזרו לאישור");
  });

  it("names delete_category's and restore_category's refusals", () => {
    expect(deleteFailureText(new Error("loan category is fixed"))).toBe("זו קטגוריה של הלוואה, ואי אפשר למחוק אותה.");
    expect(deleteFailureText(new Error("a loan uses this category"))).toBe("אי אפשר למחוק: הלוואה משתמשת בקטגוריה הזו.");
    expect(deleteFailureText(new Error("forbidden"))).toBe("לא הצלחנו למחוק את הקטגוריה.");
    expect(restoreFailureText(new Error("category cannot be restored"))).toBe("אי אפשר לבטל: חלק מהתנועות כבר שויכו מחדש.");
    expect(restoreFailureText(new Error("Failed to fetch"))).toBe("לא הצלחנו לבטל את המחיקה.");
  });

  it("counts moved lines and names the move refusals", () => {
    expect(movedToast(0, "שיפוץ")).toBe("לא היו תנועות להעביר");
    expect(movedToast(1, "שיפוץ")).toBe("תנועה אחת עברה אל שיפוץ");
    expect(movedToast(4, "שיפוץ")).toBe("4 תנועות עברו אל שיפוץ");
    expect(moveFailureText(new Error("a loan uses this category for a part the other category cannot take"))).toBe(
      "אי אפשר להעביר: הלוואה משתמשת בקטגוריה הזו לחלק שהיעד לא מתאים לו.",
    );
    expect(moveFailureText(new Error("a split line has both categories"))).toBe("אי אפשר להעביר: שורה מפוצלת משתמשת בשתי הקטגוריות.");
    expect(moveFailureText(new Error("categories must be the same kind"))).toBe("אפשר להעביר רק לקטגוריה מאותו סוג.");
    expect(moveFailureText(new Error("category not found"))).toBe("הקטגוריה לא נמצאה או מוסתרת.");
    expect(moveFailureText(new Error("validation"))).toBe("לא הצלחנו להעביר את התנועות.");
    expect(undoMoveFailureText(new Error("category move cannot be undone"))).toBe("אי אפשר לבטל: חלק מהתנועות השתנו מאז.");
    expect(undoMoveFailureText(new Error("move not found"))).toBe("לא הצלחנו לבטל את ההעברה.");
  });
});
