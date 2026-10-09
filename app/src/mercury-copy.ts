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

/** Hebrew for a known Mercury code. An unknown code becomes the generic sentence. */
export function hebrewMercuryError(code: string | null | undefined): string | null {
  if (!code) return null;
  return MERCURY_ERRORS[code] ?? "החיבור נכשל. נסו שוב.";
}

export { israelSyncPhrase };

/**
 * The toast after a manual Mercury refresh (FLOW-509): how many lines it brought in.
 * Only a run that read everything says a count; a run that stops early (the next run
 * carries on) or an older server that sends no count keeps the plain sentence.
 */
export function mercuryRefreshDone(result: unknown): string {
  const done = "הרענון הסתיים.";
  if (result == null || typeof result !== "object") return done;
  const { complete, inserted } = result as { complete?: unknown; inserted?: unknown };
  if (complete !== true || typeof inserted !== "number" || !Number.isInteger(inserted) || inserted < 0) return done;
  if (inserted === 0) return `${done} אין תנועות חדשות.`;
  if (inserted === 1) return `${done} תנועה חדשה אחת.`;
  return `${done} ${String(inserted)} תנועות חדשות.`;
}
