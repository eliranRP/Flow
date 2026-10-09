/** Hebrew for the first-run setup. Strings match the design copy. Notifications are not a step. */

export const SETUP_TOTAL = 5;

/** Production host. Drawings use `location.host`, never a stand-in domain. */
export const SETUP_PRODUCTION_ORIGIN = "https://flow-app-dx5.pages.dev";

/**
 * Loan and transfer seeds. Two of these rows are not excluded, so the setup count matches them by name.
 */
const SYSTEM_CATEGORY_NAMES = new Set([
  "תשלומי הלוואה",
  "העברות",
  "ריבית משכנתא",
  "מסים וביטוח",
]);

/** Visible categories a new company should see. Hidden and system rows stay out. */
export function visibleCategoryNames(rows: readonly { name: string; hidden?: boolean }[]): string[] {
  return rows
    .filter((row) => row.hidden !== true && row.name !== "" && !SYSTEM_CATEGORY_NAMES.has(row.name))
    .map((row) => row.name);
}

export const DEFAULT_CATEGORY_NAMES = [
  "חומרים",
  "קבלני משנה",
  "עבודה",
  "ציוד והשכרה",
  "הובלה",
  "ביטוח",
  "אחר",
  "תקבול מלקוח",
  "הכנסה אחרת",
] as const;

export const STEP_TITLE: Record<number, string> = {
  0: "פרטי העסק",
  1: "חיבור ספרים ובנק",
  2: "תיוג חכם",
  3: "הפרויקטים שלך",
  4: "אישור ראשון",
  5: "התקנה",
};

export function setupHost(): string {
  if (typeof location === "undefined" || location.host === "") return new URL(SETUP_PRODUCTION_ORIGIN).host;
  return location.host;
}

export function progressCaption(step: number): string {
  return `שלב ${String(step)} מתוך ${String(SETUP_TOTAL)}`;
}

export function cardHeading(done: number): string {
  return `הגדרה · ${String(done)} מתוך ${String(SETUP_TOTAL)}`;
}

export function settingsHint(done: number): string {
  return `${String(done)} מתוך ${String(SETUP_TOTAL)}`;
}

export function projectTitle(count: number): string {
  if (count <= 0) return "אין פרויקטים";
  if (count === 1) return "פרויקט אחד";
  return `${String(count)} פרויקטים`;
}

export function categoryTitle(count: number): string {
  if (count === 1) return "קטגוריה אחת";
  return `${String(count)} קטגוריות`;
}

/** First names, then how many remain. The remainder is a separate number for an LTR isolate. */
export function nameHint(names: readonly string[], shown: number): { head: string; rest: number } {
  const head = names.slice(0, shown).filter((name) => name !== "");
  const rest = Math.max(0, names.length - head.length);
  return { head: head.join(", "), rest };
}

export function reviewLine(count: number): string {
  if (count === 1) return "תנועה אחת מחכה. אישור הוא הקשה אחת.";
  return `${String(count)} תנועות מחכות. אישור הוא הקשה אחת.`;
}

export const VAT_HINT = {
  registered: "עוסק מורשה: מע״מ 18%.",
  exempt: "עוסק פטור: בלי מע״מ.",
} as const;

export const JEV_HINT = "ההצעות נשמרות לבדיקה ולא ממולאות אוטומטית.";

export const NO_PROJECTS_HINT = "פרויקטים מגיעים מ־SUMIT, ואפשר גם לפתוח אחד כאן.";

export const SUMIT_FAILURE_TITLE = "SUMIT עוד לא מחובר.";

export const SUMIT_FAILURE_LINE = "בודקים את מספר החברה ואת המפתח, ומנסים שוב.";

export const COMPLETED_TOAST = "ההגדרה הושלמה.";

/** One tap opts out of setup for good: the card and the next-launch resume both stop. */
export const DISMISS_LABEL = "סגירת ההגדרה";

export const DISMISS_TOAST = "ההגדרה לא תופיע שוב. אפשר לחזור אליה מההגדרות.";

export const SAMPLE_TOAST = "אישור ראשון. אפשר להמשיך בהגדרה.";

export const SAVE_ERROR = "לא הצלחנו לשמור.";
