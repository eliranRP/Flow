import { setupHost } from "./copy";

/**
 * The scenes of the setup's movies (FLOW-514 §2). Every name is invented (Northline Supply, D. Avery,
 * Birch Lane, Lantern Home Loans and the rest), never a board sample.
 */

export type MovieTone = "income" | "expense";

export type MovieRow = {
  /** The initials or glyph in the row's circle. */
  mark: string;
  title: string;
  /** Muted line under the title. */
  meta: string;
  /** The amount at the end, already formatted. */
  amount?: string;
  amountTone?: MovieTone;
  /** A status chip at the end of the title. */
  tag?: { label: string; tone: "accent" | "good" | "muted" };
  highlighted?: boolean;
};

export type MovieScene = {
  caption: string;
  rows: MovieRow[];
  /** The pill under the rows, centred. */
  pill?: string;
  /** Where the finger taps, in px from the panel top. Null hides the finger. */
  tapY: number | null;
};

export type MovieData = {
  label: string;
  scenes: [MovieScene, MovieScene, MovieScene];
};

const NORTHLINE: MovieRow = { mark: "NS", title: "Northline Supply", meta: "Mercury ••1234 · עכשיו", amount: "−$409.01", tag: { label: "חדש", tone: "accent" }, highlighted: true };
const AVERY: MovieRow = { mark: "DA", title: "D. Avery", meta: "שכירות · 09/10", amount: "+$1,850.00", amountTone: "income" };

export const WELCOME_MOVIE: MovieData = {
  label: "סרטון קצר",
  scenes: [
    { caption: "תנועה נכנסת מהבנק, לבד", rows: [NORTHLINE, AVERY], tapY: null },
    {
      caption: "Flow מציע פרויקט וקטגוריה",
      rows: [
        { ...NORTHLINE, meta: "Birch Lane · חומרים", tag: { label: "הצעה", tone: "accent" } },
        { ...AVERY, meta: "Elm Row · שכירות" },
      ],
      tapY: 56,
    },
    {
      caption: "מאשרים בהקשה, והרווח מתעדכן",
      rows: [
        { ...NORTHLINE, meta: "Birch Lane · חומרים", tag: { label: "אושר ✓", tone: "good" }, highlighted: false },
        { ...AVERY, meta: "Elm Row · שכירות", tag: { label: "אושר ✓", tone: "good" } },
      ],
      pill: "רווח אוקטובר · −$3,434",
      tapY: 120,
    },
  ],
};

export const CONNECT_MOVIE: MovieData = {
  label: "סרטון קצר",
  scenes: [
    {
      caption: "ב־Mercury: Settings ← API Tokens",
      rows: [
        { mark: "M", title: "Mercury", meta: "Settings" },
        { mark: "AT", title: "API Tokens", meta: "יצירת token", highlighted: true },
      ],
      tapY: 70,
    },
    {
      caption: "בוחרים Read Only ומעתיקים",
      rows: [
        { mark: "AT", title: "Token חדש", meta: "Read Only", tag: { label: "נבחר", tone: "accent" }, highlighted: true },
        { mark: "⧉", title: "העתקה", meta: "מוצג פעם אחת" },
      ],
      tapY: 112,
    },
    {
      caption: "מדביקים ב־Flow, וזהו",
      rows: [{ mark: "F", title: "Flow · Mercury", meta: "מפתח API · ••••••••", tag: { label: "מחובר ✓", tone: "good" }, highlighted: true }],
      pill: "3 חשבונות · 214 תנועות נכנסו",
      tapY: 56,
    },
  ],
};

export const LOANS_MOVIE: MovieData = {
  label: "סרטון קצר",
  scenes: [
    {
      caption: "תשלום משכנתא יורד מהבנק",
      rows: [{ mark: "L", title: "Lantern Home Loans", meta: "Mercury ••1234 · 07/10", amount: "−$5,240.00", amountTone: "expense", tag: { label: "חדש", tone: "accent" }, highlighted: true }],
      tapY: 56,
    },
    {
      caption: "Flow מפצל אותו לפי ההלוואה",
      rows: [
        { mark: "קר", title: "קרן", meta: "מקטינה את החוב", amount: "−$3,957.00", amountTone: "expense" },
        { mark: "רב", title: "ריבית", meta: "Elm Row", amount: "−$920.00", amountTone: "expense", highlighted: true },
        { mark: "נא", title: "נאמנות", meta: "מסים וביטוח", amount: "−$363.00", amountTone: "expense" },
      ],
      tapY: null,
    },
    {
      caption: "רק הריבית והנאמנות נספרות ברווח",
      rows: [
        { mark: "רב", title: "ריבית", meta: "נספרת ברווח", amount: "−$920.00", amountTone: "expense", tag: { label: "✓", tone: "good" } },
        { mark: "קר", title: "קרן", meta: "לא נספרת ברווח", amount: "−$3,957.00", amountTone: "expense", tag: { label: "—", tone: "muted" } },
      ],
      pill: "יתרת החוב מתעדכנת לבד",
      tapY: null,
    },
  ],
};

const QUARRY: MovieRow = { mark: "QD", title: "Quarry Lane Drywall", meta: "אין פרויקט · אין קטגוריה", amount: "−$3,475.75", amountTone: "expense", tag: { label: "חדש", tone: "accent" }, highlighted: true };

export const JEV_MOVIE: MovieData = {
  label: "סרטון קצר",
  scenes: [
    { caption: "שורה חדשה, בלי פרויקט", rows: [QUARRY], tapY: 56 },
    {
      caption: "תיוג חכם מציע לפי מה שכבר אישרתם",
      rows: [{ ...QUARRY, meta: "Birch Lane · עבודה", tag: { label: "הצעה", tone: "accent" } }],
      pill: "כמו 4 החשבונות הקודמים",
      tapY: 56,
    },
    {
      caption: "אחרי כמה אישורים, זה קורה לבד",
      rows: [
        { ...QUARRY, meta: "Birch Lane · עבודה", tag: { label: "שויך לבד", tone: "good" }, highlighted: false },
        { mark: "NS", title: "Northline Supply", meta: "Birch Lane · חומרים", amount: "−$409.01", amountTone: "expense", tag: { label: "שויך לבד", tone: "good" } },
      ],
      pill: "אפשר תמיד לשנות",
      tapY: null,
    },
  ],
};

/** The host is read when the movie is shown, so the Safari line names the page's own host. */
export function installMovie(): MovieData {
  return {
    label: "סרטון קצר",
    scenes: [
      { caption: "פותחים את Flow בדפדפן בטלפון", rows: [{ mark: "🌐", title: setupHost(), meta: "Safari / Chrome" }], tapY: 56 },
      {
        caption: "שיתוף ← הוספה למסך הבית",
        rows: [
          { mark: "⇪", title: "שיתוף", meta: "Safari" },
          { mark: "+", title: "הוספה למסך הבית", meta: "Safari", highlighted: true },
        ],
        tapY: 112,
      },
      {
        caption: "Flow נפתח כמו אפליקציה",
        rows: [{ mark: "F", title: "Flow", meta: "על מסך הבית", tag: { label: "מוכן ✓", tone: "good" }, highlighted: true }],
        pill: "בלי חנות אפליקציות",
        tapY: null,
      },
    ],
  };
}
