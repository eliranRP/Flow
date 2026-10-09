/** Copy for the categories screen's refused writes (FLOW-134). */

/** set_category_excluded_from_pnl refuses a keyed loan part category (loan_part set): its P&L side is fixed. */
export function pnlFailureText(error: Error): string {
  if (error.message.includes("loan category is fixed")) {
    return "זו קטגוריה של הלוואה, ולכן המצב שלה ברווח קבוע.";
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

/** FLOW-405: the delete confirm's item line, from how many lines on the books use the category. */
export function deleteItem(name: string, lines: number | undefined): string {
  if (lines == null) return name;
  if (lines === 0) return `${name} · אין תנועות`;
  if (lines === 1) return `${name} · תנועה אחת`;
  return `${name} · ${String(lines)} תנועות`;
}

/** What happens to the lines. Unknown counts (an older payload) say the full sentence. */
export function deleteConsequence(lines: number | undefined): string {
  if (lines === 0) return "הקטגוריה תימחק מהרשימה.";
  if (lines === 1) return "התנועה תישאר בלי קטגוריה ותחזור ללשונית לאישור.";
  return "התנועות יישארו בלי קטגוריה ויחזרו ללשונית לאישור.";
}

/** The split side effect, only when some of the lines are split by category. */
export function deleteDetail(splitLines: number | undefined): string | undefined {
  if (splitLines == null || splitLines === 0) return undefined;
  if (splitLines === 1) return "אחת מהן מפוצלת, והפיצול שלה יימחק. ספקים שזכרו את הקטגוריה ישכחו אותה.";
  return `${String(splitLines)} מהן מפוצלות, והפיצול שלהן יימחק. ספקים שזכרו את הקטגוריה ישכחו אותה.`;
}

/** The toast after a delete, from delete_category's name and lines. */
export function deletedToast(name: string, lines: number): string {
  if (lines === 0) return `${name} נמחקה`;
  if (lines === 1) return `${name} נמחקה. תנועה אחת חזרה ללשונית לאישור`;
  return `${name} נמחקה. ${String(lines)} תנועות חזרו ללשונית לאישור`;
}

/** Why the delete row is disabled, when the server would refuse it. */
export const DELETE_LOAN_USED = "הלוואה משתמשת בקטגוריה. העבירו קודם את התנועות.";

/** delete_category's refusals (decision 0144). */
export function deleteFailureText(error: Error): string {
  if (error.message.includes("loan category is fixed")) return "זו קטגוריה של הלוואה, ואי אפשר למחוק אותה.";
  if (error.message.includes("a loan uses this category")) return "אי אפשר למחוק: הלוואה משתמשת בקטגוריה הזו.";
  return "לא הצלחנו למחוק את הקטגוריה.";
}

/** restore_category's refusal: a line got a category again, or the name is taken. */
export function restoreFailureText(error: Error): string {
  if (error.message.includes("category cannot be restored")) return "אי אפשר לבטל: תנועה סווגה מחדש בינתיים.";
  return "לא הצלחנו לבטל את המחיקה.";
}

/** The toast after a move, from move_category_lines' lines. */
export function movedToast(lines: number, from: string, into: string): string {
  if (lines === 0) return `לא היו תנועות להעביר מ${from}`;
  if (lines === 1) return `תנועה אחת הועברה מ${from} אל ${into}`;
  return `${String(lines)} תנועות הועברו מ${from} אל ${into}`;
}

/** The move picker's title, from the source's line count. */
export function moveTitle(lines: number | undefined): string {
  if (lines == null) return "העברת התנועות אל";
  if (lines === 1) return "העברת תנועה אחת אל";
  return `העברת ${String(lines)} תנועות אל`;
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
  if (error.message.includes("category move cannot be undone")) return "אי אפשר לבטל: תנועה סווגה מחדש בינתיים.";
  return "לא הצלחנו לבטל את ההעברה.";
}

/** Category rename (rename_category): the same bounds as create_category, trimmed. */
export const CATEGORY_NAME_MIN = 2;
export const CATEGORY_NAME_MAX = 120;
export const RENAME_CATEGORY_SAVED = "השם נשמר";
export const RENAME_CATEGORY_UNDONE = "השם הוחזר";
export const RENAME_CATEGORY_TAKEN = "יש כבר קטגוריה בשם הזה.";

export function categoryNameError(value: string): string | undefined {
  const length = Array.from(value.trim()).length;
  if (length < CATEGORY_NAME_MIN) return `שם קצר מדי – לפחות ${String(CATEGORY_NAME_MIN)} תווים`;
  if (length > CATEGORY_NAME_MAX) return `שם ארוך מדי – עד ${String(CATEGORY_NAME_MAX)} תווים`;
  return undefined;
}

/** rename_category's refusals: the name is taken in the same kind, or the name or category is not valid. */
export function renameCategoryFailureText(error: Error): string {
  if ((error as Error & { code?: string }).code === "42501") return "רק בעלי העסק יכולים לשנות שם.";
  if (error.message.includes("already")) return RENAME_CATEGORY_TAKEN;
  // The field checks the length first, so these come only from an undo.
  if (error.message.includes("too short") || error.message.includes("too long")) return "השם לא תקין.";
  if (error.message.includes("category not found")) return "הקטגוריה לא נמצאה.";
  return "השם לא נשמר.";
}
