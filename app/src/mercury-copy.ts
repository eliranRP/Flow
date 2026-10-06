import { israelSyncPhrase } from "./sumit-copy";

const MERCURY_ERRORS: Record<string, string> = {
  unauthorized: "אין הפעלה מחוברת.",
  "no company": "אין חברה פעילה לחיבור.",
  "api key is required": "צריך מפתח.",
  "could not store the connection": "לא הצלחנו לשמור את החיבור.",
  "Mercury is not connected": "Mercury לא מחובר.",
  sync_failed: "הרענון נכשל. נסו שוב.",
  rate_limited: "הרענון נכשל. נסו שוב.",
  rejected: "Mercury דחה את המפתח. צריך מפתח Read Only חדש.",
  auth: "החיבור ל־Mercury נכשל.",
  sync_page_cap: "יש יותר מדי שורות לרענון אחד. פנו לתמיכה.",
  sync_skipped: "הרענון דילג. אפשר שוב בעוד דקה.",
  sync_cursor_conflict: "הרענון נכשל. נסו שוב.",
  connect_failed: "לא הצלחנו להתחבר. נסו שוב.",
  transient: "הרענון נכשל. נסו שוב.",
  method: "החיבור נכשל.",
};

export const MERCURY_CONNECT_HINT =
  "ב‑Mercury:\u200F All Settings\u200F ← \u200FTokens\u200F ← \u200FCreate an API Token.\u200F בוחרים Read Only, מעתיקים את המפתח כולו ומדביקים כאן.";

/** Hebrew for a known Mercury code. An unknown code becomes the generic sentence. */
export function hebrewMercuryError(code: string | null | undefined): string | null {
  if (!code) return null;
  return MERCURY_ERRORS[code] ?? "החיבור נכשל. נסו שוב.";
}

export { israelSyncPhrase };
