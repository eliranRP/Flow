import type { ReturnLine } from "./project-returns-data";
import type { InfoKey, MetricKey, PartKey } from "./project-returns-info";

/**
 * FLOW-462: the ⓘ beside each returns page's title. For every figure an investor reads on its own
 * page: what it is, how to read it, and what it is for, in the order Real Estate by the Numbers
 * reads a rental. The rules of thumb are the book's, said as a reading guide, not a target the
 * owner sets (the owner's own goals were removed in FLOW-451).
 */
export type LearnKey =
  | "cash-flow"
  | "principal"
  | "appreciation"
  | "tax"
  | "total"
  | "coc"
  | "cap-rate"
  | "dscr"
  | "per-unit"
  | "money-in"
  | "equity"
  | "forced"
  | "building"
  | "rehab";

export type Learn = {
  /** One line: what the figure is. */
  what: string;
  /** How to read it: what high, low or negative means. */
  read: string;
  /** What it is for: the question it answers about the investment. */
  goal: string;
};

export const LEARN_TITLES = { what: "מה זה", read: "איך לקרוא", goal: "בשביל מה" } as const;

export const LEARN: Record<LearnKey, Learn> = {
  "cash-flow": {
    what: "הכסף שנשאר בידיים אחרי כל ההוצאות, תשלומי ההלוואה והשיפוצים, מהשכר הראשון.",
    read: "חיובי: הנכס מממן את עצמו ומשאיר לך כסף. שלילי: אתה משלים מהכיס כל חודש. שנה עם שיפוץ גדול יכולה להיות שלילית בלי שהנכס גרוע.",
    goal: "עונה על: כמה כסף הנכס מכניס לי לכיס היום. זה מקור התשואה היחיד שמגיע כמזומן.",
  },
  principal: {
    what: "החלק מתשלומי ההלוואה שהקטין את החוב. הדייר משלם את ההלוואה בשבילך.",
    read: "גדל עם השנים, כי בכל תשלום פחות הולך לריבית ויותר לקרן. זה רווח אמיתי, אבל הוא נעול בנכס עד מכירה או מיחזור.",
    goal: "עונה על: כמה הון נבנה לי בנכס מהתשלומים. חלק מהתשואה הכוללת, לא מהתזרים.",
  },
  appreciation: {
    what: "בכמה עלה שווי הנכס בתקופה, לפי השווי שעדכנת.",
    read: "תלוי בשוק ובהערכה שלך, ולכן הכי פחות ודאי מכל המקורות. עסקה טובה לא אמורה להישען עליו.",
    goal: "עונה על: כמה התעשרתי מעליית השוק. רווח על הנייר עד שמוכרים או ממחזרים.",
  },
  tax: {
    what: "המס שהפחת חוסך לך: הבניין (בלי הקרקע) מתפחת על פני 27.5 שנים, והפחת מקטין את ההכנסה החייבת.",
    read: "הערכה לפי מדרגת המס שלך. במכירה חלק מהחיסכון חוזר כמס, אלא אם דוחים אותו. החישוב המדויק אצל רואה החשבון.",
    goal: "עונה על: כמה הנכס מוריד לי מהמס. כסף שנשאר אצלך במקום אצל רשויות המס.",
  },
  total: {
    what: "ארבעת מקורות התשואה יחד: תזרים, קרן שנפרעה, עליית ערך וחיסכון מס, ביחס לכסף שלך בעסקה.",
    read: "מראה את כל מה שהנכס עושה בשבילך, לא רק את המזומן. כדאי לבדוק מאיזה מקור הוא מגיע: תשואה שרובה עליית ערך פחות בטוחה מתשואה שרובה תזרים.",
    goal: "עונה על: כמה הכסף שלי מרוויח בשנה בכל הדרכים יחד. להשוואה מול השקעות אחרות.",
  },
  coc: {
    what: "התזרים השנתי חלקי הכסף שלך בעסקה.",
    read: "כמו ריבית על הכסף שהשקעת. ככל שהכסף בעסקה קטן יותר (למשל אחרי מיחזור), האחוז עולה. 8% עד 12% נחשב טוב לנכס להשכרה. כשכל ההון חזר, אין על מה לחלק והתשואה אינסופית.",
    goal: "עונה על: כמה מזומן הכסף שלי מחזיר בשנה. להשוואה מול פיקדון, מניות או עסקה אחרת.",
  },
  "cap-rate": {
    what: "הרווח התפעולי (NOI) חלקי שווי הנכס היום. בלי ההלוואה.",
    read: "מודד את הנכס עצמו, כאילו נקנה במזומן, ולכן מתאים להשוואה בין נכסים. גבוה יותר: הנכס מכניס יותר ביחס לשוויו, לרוב באזור עם יותר סיכון. נמוך: אזור יקר ויציב יותר. משווים לנכסים דומים באותו אזור.",
    goal: "עונה על: כמה טוב הנכס מכניס ביחס למה שהוא שווה. אם הוא נמוך מהריבית על ההלוואה, המינוף פועל נגדך.",
  },
  dscr: {
    what: "הרווח התפעולי (NOI) חלקי תשלומי ההלוואה.",
    read: "1.0: ההכנסה מכסה בדיוק את ההלוואה. מתחת ל־1: משלימים מהכיס. בנקים מבקשים לרוב 1.2 עד 1.25 לפחות, וכל מה שמעל נותן מרווח ביטחון לחודשים ריקים ולתיקונים.",
    goal: "עונה על: כמה בטוח החוב. ככל שגבוה יותר, הנכס עומד טוב יותר בתקופה רעה ומקבל מימון בקלות.",
  },
  "per-unit": {
    what: "התזרים לחודש, לכל יחידה בנכס.",
    read: "מנטרל את גודל הנכס, כך שאפשר להשוות בית ליחידות מרובות. כלל אצבע של משקיעים: 100 עד 200 דולר לדלת לחודש. פחות מזה משאיר מעט מקום לתיקון או לחודש ריק.",
    goal: "עונה על: כמה כל יחידה מכניסה לי ונותנת מרווח. לבדיקה מהירה אם הנכס שווה את הטרחה.",
  },
  "money-in": {
    what: "הכסף שלך שנשאר בעסקה: רכישה, שיפוץ והחזקה עד השכר הראשון, פחות מה שחזר מההלוואות.",
    read: "זה המכנה של התשואות: ככל שקטן יותר, כל דולר תזרים שווה יותר אחוזים. מיחזור שמחזיר כסף מוריד אותו. אפס או פחות: כל ההון חזר.",
    goal: "עונה על: כמה מהכסף שלי עדיין תקוע בנכס. המטרה ב־BRRRR היא להוריד אותו קרוב לאפס.",
  },
  equity: {
    what: "שווי הנכס היום פחות יתרת ההלוואות.",
    read: "החלק בנכס ששייך לך. גדל מעליית ערך ומפירעון קרן. הון גדול שלא עובד (תשואה נמוכה עליו) הוא סימן לשקול מיחזור או מכירה.",
    goal: "עונה על: כמה אני שווה בנכס הזה. הבסיס להחלטה אם להחזיק, למחזר או למכור.",
  },
  forced: {
    what: "השווי אחרי שיפוץ (ARV) פחות הקנייה והשיפוץ.",
    read: "הערך שיצרת בעבודה, לא מהשוק. חיובי: השיפוץ הוסיף יותר ממה שעלה. שלילי: שילמת יותר ממה שהנכס שווה אחרי השיפוץ, או שה־ARV שהוזן נמוך.",
    goal: "עונה על: האם הקנייה והשיפוץ יצרו ערך. זה הכסף שמיחזור יכול להוציא חזרה.",
  },
  building: {
    what: "הקנייה והשיפוץ, בלי הקרקע. זה מה שמתפחת.",
    read: "הקרקע לא מתפחתת, ולכן ככל ששווי הקרקע קטן יותר, הפחת והחיסכון במס גדולים יותר.",
    goal: "עונה על: על כמה מהנכס מגיע לי פחת. הבסיס לחיסכון במס.",
  },
  rehab: {
    what: "כל מה ששילמת על שיפוץ הנכס מאז הקנייה, לפי הקטגוריות שמסומנות כשיפוץ.",
    read: "נכנס לעלות הבניין ולפחת. שיפוץ לפני השכר הראשון נכנס לכסף בעסקה, ואחריו מוריד את התזרים של אותה שנה.",
    goal: "עונה על: כמה השקעתי בשיפור הנכס. בהשוואה ל־ARV מראה אם השיפוץ השתלם.",
  },
};

/** The figure ⓘ sheets on the total-return card: each ends with how to read the figure. */
export const INFO_LEARN: Record<InfoKey, LearnKey> = {
  cash_flow: "cash-flow",
  principal: "principal",
  appreciation: "appreciation",
  tax: "tax",
  equity_today: "equity",
  forced: "forced",
  money_in: "money-in",
};

/** Each returns page's ⓘ: the statement, the principal's line, every metric and every part. A page not here has none. */
export const PAGE_LEARN = {
  statement: "cash-flow",
  line: { principal: "principal" },
  metric: { coc: "coc", "cap-rate": "cap-rate", dscr: "dscr", "per-unit": "per-unit" },
  part: { building: "building", "money-in": "money-in", forced: "forced", rehab: "rehab" },
} as const satisfies {
  statement: LearnKey;
  line: Partial<Record<ReturnLine, LearnKey>>;
  metric: Record<MetricKey, LearnKey>;
  part: Record<PartKey, LearnKey>;
};
