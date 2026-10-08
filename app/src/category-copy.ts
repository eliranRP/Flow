/** Copy for the categories screen's refused writes (FLOW-134). */

/** set_category_excluded_from_pnl, and the trigger behind it, refuse a category a loan uses for a part. */
export function pnlFailureText(error: Error): string {
  if (error.message.includes("loan category is fixed")) {
    return "הלוואה משתמשת בקטגוריה הזו, ולכן אי אפשר לשנות אם היא ברווח והפסד.";
  }
  return "לא הצלחנו לעדכן את הקטגוריה.";
}

/** merge_category's refusals. */
export function mergeFailureText(error: Error): string {
  if (error.message.includes("a loan uses this category")) {
    return "הלוואה משתמשת בקטגוריה הזו לחלק שהקטגוריה השנייה לא יכולה לקבל.";
  }
  if (error.message.includes("a split line has both categories")) return "שורה מפוצלת משתמשת בשתי הקטגוריות.";
  return "לא הצלחנו למזג.";
}
