/** Copy for the categories screen's refused writes (FLOW-134). */

/** set_category_excluded_from_pnl refuses a keyed loan part category (loan_part set): its P&L side is fixed. */
export function pnlFailureText(error: Error): string {
  if (error.message.includes("loan category is fixed")) {
    return "זו קטגוריה של הלוואה, ולכן המצב שלה ברווח והפסד קבוע.";
  }
  return "לא הצלחנו לעדכן את הקטגוריה.";
}

/** merge_category's refusals. */
export function mergeFailureText(error: Error): string {
  if (error.message.includes("a loan uses this category")) {
    return "אי אפשר למזג: הלוואה משתמשת בקטגוריה הזו לחלק שהקטגוריה השנייה לא מתאימה לו.";
  }
  if (error.message.includes("a split line has both categories")) return "אי אפשר למזג: שורה מפוצלת משתמשת בשתי הקטגוריות.";
  return "לא הצלחנו למזג.";
}

/** FLOW-405: the delete confirm's line, from how many lines on the books use the category. */
export function deleteConsequence(lines: number): string {
  if (lines === 0) return "אין בה תנועות.";
  if (lines === 1) return "תנועה אחת תחזור לאישור בלי קטגוריה.";
  return `${String(lines)} תנועות יחזרו לאישור בלי קטגוריה.`;
}

/** The toast after a delete, from delete_category's name and lines. */
export function deletedToast(name: string, lines: number): string {
  if (lines === 0) return `${name} נמחקה`;
  if (lines === 1) return `${name} נמחקה · תנועה אחת חזרה לאישור`;
  return `${name} נמחקה · ${String(lines)} תנועות חזרו לאישור`;
}

/** delete_category's refusals (decision 0144). */
export function deleteFailureText(error: Error): string {
  if (error.message.includes("loan category is fixed")) return "זו קטגוריה של הלוואה, ואי אפשר למחוק אותה.";
  if (error.message.includes("a loan uses this category")) return "אי אפשר למחוק: הלוואה משתמשת בקטגוריה הזו.";
  return "לא הצלחנו למחוק את הקטגוריה.";
}

/** restore_category's refusal: a line got a category again, or the name is taken. */
export function restoreFailureText(error: Error): string {
  if (error.message.includes("category cannot be restored")) return "אי אפשר לבטל: חלק מהתנועות כבר שויכו מחדש.";
  return "לא הצלחנו לבטל את המחיקה.";
}

/** The toast after "העברת כל התנועות", from move_category_lines' lines. */
export function movedToast(lines: number, into: string): string {
  if (lines === 0) return "לא היו תנועות להעביר";
  if (lines === 1) return `תנועה אחת עברה אל ${into}`;
  return `${String(lines)} תנועות עברו אל ${into}`;
}

/** move_category_lines' refusals, the same as merge's. */
export function moveFailureText(error: Error): string {
  if (error.message.includes("a loan uses this category")) {
    return "אי אפשר להעביר: הלוואה משתמשת בקטגוריה הזו לחלק שהיעד לא מתאים לו.";
  }
  if (error.message.includes("a split line has both categories")) return "אי אפשר להעביר: שורה מפוצלת משתמשת בשתי הקטגוריות.";
  if (error.message.includes("categories must be the same kind")) return "אפשר להעביר רק לקטגוריה מאותו סוג.";
  if (error.message.includes("category not found")) return "הקטגוריה לא נמצאה או מוסתרת.";
  return "לא הצלחנו להעביר את התנועות.";
}

/** undo_category_move's refusal: a moved line changed since. */
export function undoMoveFailureText(error: Error): string {
  if (error.message.includes("category move cannot be undone")) return "אי אפשר לבטל: חלק מהתנועות השתנו מאז.";
  return "לא הצלחנו לבטל את ההעברה.";
}
