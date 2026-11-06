import type { ReturnLine } from "./project-returns-data";
import type { AnyMetricKey } from "./project-returns-deal";
import type { InfoKey, PartKey } from "./project-returns-info";

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
  | "rehab"
  | "profit"
  | "roi-since"
  | "roe"
  | "multiple"
  | "break-even"
  | "ltv"
  | "grm"
  | "expense-ratio"
  | "flip-roi"
  | "flip-roi-year"
  | "arv-margin"
  | "rule-70"
  | "break-even-sale";

export type Learn = {
  /** One line: what the figure is. */
  what: string;
  /** How to read it: what high, low or negative means. */
  read: string;
  /** What it is for: the question it answers about the investment. */
  goal: string;
};

export const LEARN_TITLES = { what: "מה זה", read: "איך לקרוא", goal: "בשביל מה" } as const;

/**
 * The investor's English name of each figure, as Real Estate by the Numbers and lenders say it, under
 * the ⓘ sheet's Hebrew title (FLOW-465). Cap rate's title is already English, so it has none.
 */
export const LEARN_ENGLISH: Record<LearnKey, string | null> = {
  "cash-flow": "Cash flow",
  principal: "Principal paydown",
  appreciation: "Appreciation",
  tax: "Tax savings (depreciation)",
  total: "Total return",
  coc: "Cash-on-cash return (CoC)",
  "cap-rate": null,
  dscr: "Debt service coverage ratio",
  "per-unit": "Cash flow per door",
  "money-in": "Cash invested",
  equity: "Equity",
  forced: "Forced appreciation",
  building: "Depreciable basis",
  rehab: "Rehab costs",
  profit: "Net profit",
  "roi-since": "Return on investment (ROI)",
  roe: "Return on equity (ROE)",
  multiple: "Equity multiple",
  "break-even": "Break-even occupancy",
  ltv: "Loan to value (LTV)",
  grm: "Gross rent multiplier (GRM)",
  "expense-ratio": "Operating expense ratio",
  "flip-roi": "Return on investment (ROI)",
  "flip-roi-year": "Annualized ROI",
  "arv-margin": "Profit margin",
  "rule-70": "The 70% rule",
  "break-even-sale": "Break-even sale price",
};

/** The English name for the sheet's subtitle, in an LTR isolate so its brackets read right in a Hebrew sheet. */
export function englishName(key: LearnKey): string | undefined {
  const name = LEARN_ENGLISH[key];
  return name == null ? undefined : `\u2066${name}\u2069`;
}

export const LEARN: Record<LearnKey, Learn> = {
  "cash-flow": {
    what: "הכסף שנשאר בידיים אחרי כל ההוצאות, תשלומי ההלוואה והשיפוצים, מהשכירות הראשונה.",
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
    what: "הכסף שלך שנשאר בעסקה: רכישה, שיפוץ והחזקה עד השכירות הראשונה, פחות מה שחזר מההלוואות.",
    read: "זה המכנה של התשואות: ככל שקטן יותר, כל דולר תזרים שווה יותר אחוזים. מיחזור שמחזיר כסף מוריד אותו. אפס או פחות: כל ההון חזר.",
    goal: "עונה על: כמה מהכסף שלי עדיין תקוע בנכס. המטרה ב־BRRRR (קנייה, שיפוץ, השכרה ומיחזור שמחזיר את הכסף) היא להוריד אותו קרוב לאפס.",
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
    read: "נכנס לעלות הבניין ולפחת. שיפוץ לפני השכירות הראשונה נכנס לכסף בעסקה, ואחריו מוריד את התזרים של אותה שנה.",
    goal: "עונה על: כמה השקעתי בשיפור הנכס. בהשוואה ל־ARV מראה אם השיפוץ השתלם.",
  },
  profit: {
    what: "מה שיישאר במכירה אחרי כל העלויות: הקנייה, השיפוץ, ההחזקה (ריבית, ביטוח, ארנונה) ועלויות המכירה (תיווך וסגירה).",
    read: "עלויות המכירה הן הערכה של 8% מה־ARV עד שמשנים אותן. רווח שנראה טוב רק בלי עלויות המכירה וההחזקה הוא עסקה צפופה.",
    goal: "עונה על: כמה כסף העסקה תשאיר לי בסוף. הבסיס ל־ROI של העסקה.",
  },
  "roi-since": {
    what: "כמה הרווחת על הכסף שהכנסת, מאז הקנייה: התזרים שחזר והון עצמי היום, פחות הכסף בעסקה, חלקי הכסף בעסקה.",
    read: "כולל את מה שעוד נעול בנכס (ההון), לא רק מזומן. 100% אומר שהכסף הוכפל. לא מחולק לשנים, ולכן נכס שמוחזק הרבה זמן יראה מספר גבוה יותר.",
    goal: "עונה על: כמה התעשרתי מהעסקה הזאת עד היום, ביחס למה שהכנסתי.",
  },
  roe: {
    what: "התשואה הכוללת של השנה חלקי ההון העצמי בנכס היום (שווי פחות הלוואות).",
    read: "ההון גדל עם עליית הערך והחזר הקרן, ולכן ROE יורד עם השנים. כשהוא נמוך ממה שהכסף היה מרוויח במקום אחר, ההון לא עובד מספיק: שווה לבדוק מיחזור או מכירה.",
    goal: "עונה על: האם ההון שתקוע בנכס עדיין עובד בשבילי.",
  },
  multiple: {
    what: "התזרים שחזר והון עצמי היום, חלקי הכסף שהכנסת לעסקה.",
    read: "1.0x: יצאת באפס. 2.0x: הכסף הוכפל. לא מתחשב בזמן, ולכן כדאי לקרוא אותו לצד התשואה השנתית.",
    goal: "עונה על: כמה דולרים חזרו או נבנו על כל דולר שהשקעתי.",
  },
  "break-even": {
    what: "הוצאות התפעול ותשלומי ההלוואה חלקי ההכנסות: איזה חלק מהשכירות צריך כדי לא להפסיד.",
    read: "ככל שנמוך יותר, יש יותר מרווח לחודשים ריקים. מעל 85% בערך: כל חודש ריק כמעט מוריד את התזרים מתחת לאפס.",
    goal: "עונה על: כמה ריקנות הנכס יכול לספוג לפני שאני משלים מהכיס.",
  },
  ltv: {
    what: "יתרת ההלוואות חלקי שווי הנכס היום.",
    read: "ככל שגבוה יותר, יש פחות הון בנכס ויותר סיכון אם המחירים יורדים. מלווים למשקיעים מממנים לרוב עד 70% עד 80%. מתחת לזה יש מקום למיחזור.",
    goal: "עונה על: כמה ממונף הנכס, והאם אפשר להוציא ממנו הון.",
  },
  grm: {
    what: "מחיר הרכישה חלקי השכירות של שנה.",
    read: "כמה שנות שכירות (לפני הוצאות) המחיר שווה. נמוך יותר: הנכס זול ביחס לשכירות. טוב להשוואה מהירה בין נכסים באותו אזור, לא במקום NOI.",
    goal: "עונה על: האם שילמתי מחיר סביר ביחס לשכירות.",
  },
  "expense-ratio": {
    what: "הוצאות התפעול חלקי ההכנסות.",
    read: "כלל אצבע של משקיעים: בסביבות 35% עד 50% לבית להשכרה. נמוך מאוד יכול לרמוז שחסרות הוצאות בספרים, גבוה מאוד שהנכס יקר לתחזוקה.",
    goal: "עונה על: כמה מהשכירות הולך להחזקת הנכס.",
  },
  "flip-roi": {
    what: "הרווח הנקי הצפוי חלקי הכסף שלך בעסקה.",
    read: "ככל שהמימון מכסה יותר, הכסף בעסקה קטן וה־ROI עולה, אבל גם הסיכון. כשכל הכסף בעסקה חזר מהמימון, אין על מה לחלק.",
    goal: "עונה על: כמה הכסף שלי מרוויח בעסקה הזאת.",
  },
  "flip-roi-year": {
    what: "ה־ROI של העסקה, מחולק לשנה לפי הזמן מהקנייה עד היום.",
    read: "עסקה של 20% בחצי שנה שווה כ־40% בשנה. ככל שהעסקה נמשכת, ה־ROI השנתי יורד, גם אם הרווח לא משתנה.",
    goal: "עונה על: איך העסקה משתווה לעסקאות באורך אחר או להשקעה אחרת.",
  },
  "arv-margin": {
    what: "הרווח הנקי הצפוי חלקי השווי אחרי שיפוץ.",
    read: "המרווח לטעויות: אם המחיר במכירה יורד ביותר מזה, העסקה בהפסד. משקיעים מחפשים לרוב 10% ומעלה.",
    goal: "עונה על: כמה מקום יש לטעות בהערכת ה־ARV.",
  },
  "rule-70": {
    what: "כלל אצבע של משקיעים בשיפוץ: לא לשלם יותר מ־70% מה־ARV פחות עלות השיפוץ.",
    read: "חיובי: קנית מתחת לכלל ויש מקום לעלויות ולרווח. שלילי: שילמת מעליו, וכל טעות בשיפוץ או במכירה יורדת ישר מהרווח.",
    goal: "עונה על: האם המחיר ששולם השאיר מרווח ביטחון.",
  },
  "break-even-sale": {
    what: "המחיר שבו המכירה מכסה בדיוק את כל העלויות ואת עלויות המכירה, בלי רווח.",
    read: "ככל שרחוק יותר מה־ARV, יש יותר מקום לירידת מחיר. מכירה מתחת לזה היא הפסד.",
    goal: "עונה על: עד כמה המחיר יכול לרדת לפני שאני מפסיד.",
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
  metric: {
    coc: "coc", "cap-rate": "cap-rate", dscr: "dscr", "per-unit": "per-unit",
    "roi-since": "roi-since", roe: "roe", multiple: "multiple", "break-even": "break-even", ltv: "ltv", grm: "grm", "expense-ratio": "expense-ratio",
    "flip-roi": "flip-roi", "flip-roi-year": "flip-roi-year", "arv-margin": "arv-margin", "rule-70": "rule-70", "break-even-sale": "break-even-sale",
  },
  part: { building: "building", "money-in": "money-in", rehab: "rehab", profit: "profit" },
} as const satisfies {
  statement: LearnKey;
  line: Partial<Record<ReturnLine, LearnKey>>;
  metric: Record<AnyMetricKey, LearnKey>;
  part: Record<PartKey, LearnKey>;
};
