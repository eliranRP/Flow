import { describe, expect, it } from "vitest";
import {
  deleteConsequence,
  deleteDetail,
  deleteItem,
  deletedToast,
  deleteFailureText,
  mergeFailureText,
  moveFailureText,
  movedToast,
  moveHint,
  moveTitle,
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
  it("names the count, the split side effect and the toast", () => {
    expect(deleteItem("ציוד", 0)).toBe("ציוד · אין תנועות");
    expect(deleteItem("ציוד", 1)).toBe("ציוד · תנועה אחת");
    expect(deleteItem("ציוד", 42)).toBe("ציוד · 42 תנועות");
    expect(deleteItem("ציוד", undefined)).toBe("ציוד");
    expect(deleteConsequence(0)).toBe("הקטגוריה תימחק מהרשימה.");
    expect(deleteConsequence(1)).toBe("התנועה תישאר בלי קטגוריה ותחזור ללשונית לאישור.");
    expect(deleteConsequence(3)).toBe("התנועות יישארו בלי קטגוריה ויחזרו ללשונית לאישור.");
    expect(deleteDetail(0)).toBeUndefined();
    expect(deleteDetail(1)).toBe("אחת מהן מפוצלת, והפיצול שלה יימחק. ספקים שזכרו את הקטגוריה ישכחו אותה.");
    expect(deleteDetail(3)).toBe("3 מהן מפוצלות, והפיצול שלהן יימחק. ספקים שזכרו את הקטגוריה ישכחו אותה.");
    expect(deletedToast("ציוד", 0)).toBe("ציוד נמחקה");
    expect(deletedToast("ציוד", 1)).toBe("ציוד נמחקה. תנועה אחת חזרה ללשונית לאישור");
    expect(deletedToast("ציוד", 42)).toBe("ציוד נמחקה. 42 תנועות חזרו ללשונית לאישור");
  });

  it("names delete_category's and restore_category's refusals", () => {
    expect(deleteFailureText(new Error("loan category is fixed"))).toBe("זו קטגוריה של הלוואה, ואי אפשר למחוק אותה.");
    expect(deleteFailureText(new Error("a loan uses this category"))).toBe("אי אפשר למחוק: הלוואה משתמשת בקטגוריה הזו.");
    expect(deleteFailureText(new Error("forbidden"))).toBe("לא הצלחנו למחוק את הקטגוריה.");
    expect(restoreFailureText(new Error("category cannot be restored"))).toBe("אי אפשר לבטל: תנועה סווגה מחדש בינתיים.");
    expect(restoreFailureText(new Error("Failed to fetch"))).toBe("לא הצלחנו לבטל את המחיקה.");
  });

  it("counts moved lines and names the move refusals", () => {
    expect(moveHint("חומרים", 42)).toBe("42 תנועות עוברות לקטגוריה אחרת. חומרים נשארת.");
    expect(moveHint("חומרים", 1)).toBe("תנועה אחת עוברת לקטגוריה אחרת. חומרים נשארת.");
    expect(moveHint("חומרים", 0)).toBe("אין תנועות להעביר.");
    expect(moveTitle(42)).toBe("העברת 42 תנועות אל");
    expect(moveTitle(undefined)).toBe("העברת התנועות אל");
    expect(movedToast(0, "חומרים", "קבלנים")).toBe("לא היו תנועות להעביר מחומרים");
    expect(movedToast(1, "חומרים", "קבלנים")).toBe("תנועה אחת הועברה מחומרים אל קבלנים");
    expect(movedToast(42, "חומרים", "קבלנים")).toBe("42 תנועות הועברו מחומרים אל קבלנים");
    expect(moveFailureText(new Error("a loan uses this category for a part the other category cannot take"))).toBe(
      "אי אפשר להעביר: הלוואה משתמשת בקטגוריה הזו לחלק שהיעד לא מתאים לו.",
    );
    expect(moveFailureText(new Error("a split line has both categories"))).toBe("אי אפשר להעביר: שורה מפוצלת משתמשת בשתי הקטגוריות.");
    expect(moveFailureText(new Error("categories must be the same kind"))).toBe("אפשר להעביר רק לקטגוריה מאותו סוג.");
    expect(moveFailureText(new Error("category not found"))).toBe("הקטגוריה לא נמצאה או מוסתרת.");
    expect(moveFailureText(new Error("validation"))).toBe("לא הצלחנו להעביר את התנועות.");
    expect(undoMoveFailureText(new Error("category move cannot be undone"))).toBe("אי אפשר לבטל: תנועה סווגה מחדש בינתיים.");
    expect(undoMoveFailureText(new Error("move not found"))).toBe("לא הצלחנו לבטל את ההעברה.");
  });
});
