/**
 * FLOW-977 (decision 0225): what the live terms and privacy pages say until the lawyer signs off.
 * The draft for the lawyer lives only in docs/legal/ and is never shown in the app (a public page
 * with unreviewed terms is a legal risk); the final text replaces these lines when it is approved.
 */
export type LegalText = { title: string; paragraphs: string[] };

export const TERMS: LegalText = {
  title: "תנאי השימוש",
  paragraphs: ["Flow שומר את נתוני העסק שלכם אצלכם. תנאי השימוש המלאים יפורסמו לפני ההשקה."],
};

export const PRIVACY: LegalText = {
  title: "מדיניות הפרטיות",
  paragraphs: ["בכניסה עם Google אנחנו מקבלים רק שם ואימייל. אין גישה לתיבת הדואר."],
};
