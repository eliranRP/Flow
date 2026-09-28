const SUMIT_ERRORS: Record<string, string> = {
  unauthorized: "אין הפעלה מחוברת.",
  "no company": "עדיין אין עסק על החשבון.",
  "company id and api key are required": "צריך מזהה חברה ומפתח.",
  "could not store the connection": "לא הצלחנו לשמור את החיבור.",
  "SUMIT is not connected": "SUMIT לא מחובר.",
  sync_failed: "הרענון נכשל. נסו שוב.",
  sumit_rejected: "SUMIT חסמה זמנית את החיבור. נבדוק שוב מאוחר יותר.",
  sync_page_cap: "יש יותר מדי מסמכים לרענון אחד. פנו לתמיכה.",
  sync_skipped: "הרענון דילג. אפשר שוב בעוד דקה.",
  sync_sweep_empty: "הרענון הגיע בלי מסמכים, אז הספרים לא נמחקו.",
  sync_sweep_suspicious: "הרענון נראה חלקי, אז מסמכים ישנים לא נמחקו.",
  connect_failed: "החיבור נכשל. בדקו את המזהה ואת המפתח.",
  method: "החיבור נכשל.",
};

/** Hebrew for a known SUMIT code. An unknown code becomes the generic sentence. */
export function hebrewSumitError(code: string | null | undefined): string | null {
  if (!code) return null;
  return SUMIT_ERRORS[code] ?? "החיבור נכשל. נסו שוב.";
}
