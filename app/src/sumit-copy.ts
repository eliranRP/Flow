const SUMIT_ERRORS: Record<string, string> = {
  unauthorized: "אין הפעלה מחוברת.",
  "no company": "עדיין אין עסק על החשבון.",
  "company id and api key are required": "צריך מזהה חברה ומפתח.",
  "could not store the connection": "לא הצלחנו לשמור את החיבור.",
  "SUMIT is not connected": "SUMIT לא מחובר.",
  sync_failed: "הרענון נכשל. נסו שוב.",
  connect_failed: "החיבור נכשל. בדקו את המזהה ואת המפתח.",
  method: "החיבור נכשל.",
};

/** Hebrew for a known SUMIT code. Anything else is logged and replaced. */
export function hebrewSumitError(code: string | null | undefined): string | null {
  if (!code) return null;
  const mapped = SUMIT_ERRORS[code];
  if (mapped) return mapped;
  console.error("sumit error", code);
  return "החיבור נכשל. נסו שוב.";
}
