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
