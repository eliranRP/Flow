/** Hebrew for the first-time setup (FLOW-514). Strings match the board. Invented sample names only. */

export const SETUP_TOTAL = 7;

/** Production host. Drawings use `location.host`, never a stand-in domain. */
export const SETUP_PRODUCTION_ORIGIN = "https://flow-app-dx5.pages.dev";

export const SAVE_ERROR = "לא הצלחנו לשמור.";

export const VAT_HINT = {
  registered: "עוסק מורשה: מע״מ 18%.",
  exempt: "עוסק פטור: בלי מע״מ.",
} as const;

/** The name the business gets when the skip-all sheet creates it (board: "העסק שלי"). */
export const SKIP_ALL_COMPANY_NAME = "העסק שלי";

export const STEP_TITLE: Record<number, string> = {
  1: "העסק",
  2: "חיבור הבנק והספרים",
  3: "הפרויקטים שלכם",
  4: "הלוואות",
  5: "תיוג חכם",
  6: "ננסה אישור אחד",
  7: "Flow על מסך הבית",
};

export const WELCOME_TITLE = "ברוכים הבאים ל־Flow";
export const WELCOME_LEAD = "רואים בכל יום כמה כסף יש, ובכל חודש כמה כל פרויקט מרוויח. ההגדרה לוקחת כ־3 דקות.";
export const WELCOME_NEXT = "בואו נתחיל";
export const WELCOME_MOVIE_LABEL = "סרטון קצר";
export const WELCOME_LATER = "דילוג, אגדיר אחר כך";

export const NEXT = "המשך";
export const BACK = "הקודם";
export const SKIP_ALL = "דילוג על הכל";
export const SKIP_STEP = "דילוג על השלב";

// 1 · העסק
export const BUSINESS_LEAD = "השם יופיע בבית ובדוחות. אפשר לשנות אחר כך.";
export const CURRENCY_LABEL = "מטבע";
export const CURRENCY_OPTIONS = [
  { value: "USD", label: "$ דולר" },
  { value: "ILS", label: "₪ שקל" },
] as const;
export const BUSINESS_NAME_PLACEHOLDER = "למשל ברוש נכסים";
export const BASIS_LABEL = "רווח ותזרים לפי";
export const BASIS_OPTIONS = [
  { value: "paid", label: "תאריך תשלום" },
  { value: "invoice", label: "תאריך חשבונית" },
] as const;
export const BASIS_NOTE = {
  paid: "מומלץ: נספר כשהכסף באמת זז. חשבונית פתוחה עוד לא נספרת.",
  invoice: "נספר לפי תאריך המסמך, גם אם עוד לא שולם.",
} as const;

// 2 · חיבור
export const CONNECT_LEAD = "מכאן התנועות נכנסות לבד. צפו איך מוצאים את המפתח ב־Mercury:";
export const CONNECT_NOTE = "Flow רק קורא. הוא לא מעביר כסף ולא משנה כלום בבנק או ב־SUMIT.";
export const CONNECT_NO_BANK = "המשך בלי בנק";
export const CONNECT_DONE_LABEL = "מחובר";
export const CONNECT_BUTTON = "חיבור";
export const CONNECT_BUSY = "מתחבר…";
export const CONNECT_CONNECTED = "מחובר ✓";
export const CONNECT_ROWS = {
  mercury: { name: "Mercury", sub: "בנק · תנועות כל 15 דקות" },
  sumit: { name: "SUMIT", sub: "חשבוניות, קבלות והוצאות" },
} as const;

// 3 · פרויקטים
export const PROJECTS_LEAD = "נכס, שיפוץ או עבודה ללקוח. כל שורה תשויך לאחד מהם.";
export const PROJECT_PLACEHOLDER = "שם הפרויקט, למשל Birch Lane";
export const PROJECT_ADD = "הוספה";
export const SUGGESTED_PROJECTS_LABEL = "מהבנק נראה שיש לכם עוד:";

export function projectsPrimary(count: number): string {
  if (count === 0) return NEXT;
  if (count === 1) return `${NEXT} · פרויקט אחד`;
  return `${NEXT} · ${String(count)} פרויקטים`;
}

// 4 · הלוואות
export const LOANS_LEAD = "משכנתאות והלוואות שיפוץ. בלי זה הרווח לא נכון: Flow צריך לדעת איזה חלק מהתשלום הוא ריבית.";
export const LOANS_SUGGESTED_LABEL = "מהבנק נראה שאתם משלמים ל:";
export const LOAN_ADD_OTHER = "+ הלוואה אחרת";
export const LOAN_NONE = "אין לי הלוואות";
export const LOAN_NOTE = "את הריבית, התקופה והתשלום משלימים בלשונית הלוואות. אין הלוואות? דלגו.";
export const LOAN_PENDING = "להשלמה";
export function loanPrimary(count: number): string {
  if (count === 1) return `${NEXT} · הלוואה אחת`;
  return `${NEXT} · ${String(count)} הלוואות`;
}

// 5 · תיוג חכם
export const JEV_LEAD = "במקום לשייך כל שורה ביד, Flow מציע ואתם מאשרים.";
export const JEV_LABEL = "תיוג חכם";
export const JEV_HINT = "מציע פרויקט וקטגוריה לכל שורה חדשה. אתם מאשרים.";

// 6 · אישור ראשון
export const REVIEW_LEAD = "שורות חדשות מחכות לכם בבית, תחת \"דורש טיפול\". ככה זה נראה. אשרו:";
export const REVIEW_APPROVE = "אישור";
export const REVIEW_APPROVED = "✓ אושר · נכנס לרווח של Birch Lane";
export const REVIEW_BEFORE = "אשרו את השורה למעלה";
export const REVIEW_SAMPLE_NOTE = "זו שורת דוגמה. היא לא נשמרת בספרים.";
export const REVIEW_META = "10/10 · Mercury ••1234 · שורת דוגמה";

// 7 · מסך הבית
export const INSTALL_LEAD = "נפתח בהקשה אחת, כמו אפליקציה. מומלץ להציץ פעם ביום על התזרים.";
export const NOTIFY_LABEL = "התראות";
export const NOTIFY_HINT = "כשיש מה לאשר, וסיכום ביום ראשון";
export const INSTALL_FINISH = "סיום";
export const INSTALL_LATER = "לא עכשיו";

// Done
export const DONE_TITLE = "הכל מוכן";
export const DONE_LEAD = "כל יום: כמה כסף נכנס ויצא. כל חודש: כמה כל פרויקט הרוויח. התנועות הראשונות מהבנק כבר בדרך.";
export const DONE_NOTE = "מה שדילגתם עליו מחכה בהגדרות ← הגדרה ראשונה.";
export const DONE_HOME = "לבית";

// Skip-all sheet
export const SKIP_SHEET_TITLE = "לדלג על ההגדרה?";
export const SKIP_SHEET_BODY = "אפשר לחזור אליה בכל זמן מההגדרות ← הגדרה ראשונה. עד שתחברו בנק, הבית יראה איך לחבר אותו.";
export const SKIP_SHEET_CONFIRM = "דילוג ומעבר לבית";
export const SKIP_SHEET_STAY = "המשך בהגדרה";

export const SETUP_ERROR_RETRY = "לא הצלחנו לשמור. נסו שוב.";

/** Still used by the Home card and the old review path until FLOW-365/FLOW-514 step C. */
export const COMPLETED_TOAST = "ההגדרה הושלמה.";
export const DISMISS_LABEL = "סגירת ההגדרה";
export const DISMISS_TOAST = "ההגדרה לא תופיע שוב. אפשר לחזור אליה מההגדרות.";
export const SAMPLE_TOAST = "אישור ראשון. אפשר להמשיך בהגדרה.";

export function setupHost(): string {
  if (typeof location === "undefined" || location.host === "") return new URL(SETUP_PRODUCTION_ORIGIN).host;
  return location.host;
}
