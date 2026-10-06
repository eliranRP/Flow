/** Hebrew for the first-run setup. Strings match the design copy. Notifications are not a step. */

export const SETUP_TOTAL = 5;

/** Production host. Drawings use `location.host`, never a stand-in domain. */
export const SETUP_PRODUCTION_ORIGIN = "https://flow-app-dx5.pages.dev";

/**
 * Loan and transfer seeds. list_categories does not return excluded_from_pnl,
 * and two of these rows are not excluded, so the setup count matches them by name.
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
  1: "חיבור SUMIT",
  2: "תיוג חכם",
  3: "הפרויקטים שלך",
  4: "אישור ראשון",
  5: "התקנה",
};

export const DEMO_ALT: Record<number, string> = {
  1: "הדגמה: מחברים את SUMIT, והתנועות נכנסות ללשונית לאישור.",
  2: "הדגמה: לתנועה נוספת הצעה של פרויקט וקטגוריה, מסומנת הצעה.",
  3: "הדגמה: רשימת הפרויקטים מ־SUMIT מסומנת, וקטגוריה אחת עוברת למוסתרות.",
  4: "הדגמה: הקשה על אישור, הכרטיס יוצא והמונה יורד באחד.",
  5: "הדגמה: בספארי מקישים על שלוש הנקודות, ואז שיתוף והוספה למסך הבית.",
};

export const DEMO_ALT_ANDROID = "הדגמה: הקשה על התקנה, והסמל של Flow מופיע במסך הבית.";

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

export const DISMISS_TOAST = "ההגדרה זמינה בהגדרות.";

export const SAMPLE_TOAST = "אישור ראשון. אפשר להמשיך בהגדרה.";

export const SAVE_ERROR = "לא הצלחנו לשמור.";
