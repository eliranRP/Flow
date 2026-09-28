const SUMIT_ERRORS: Record<string, string> = {
  unauthorized: "אין הפעלה מחוברת.",
  "no company": "עדיין אין עסק על החשבון.",
  "company id and api key are required": "צריך מזהה חברה ומפתח.",
  "could not store the connection": "לא הצלחנו לשמור את החיבור.",
  "SUMIT is not connected": "SUMIT לא מחובר.",
  sync_failed: "הרענון נכשל. נסו שוב.",
  sumit_rejected: "SUMIT חסמה זמנית את החיבור. נבדוק שוב מאוחר יותר.",
  sumit_auth: "החיבור ל-SUMIT נכשל. צריך לחבר מחדש.",
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

/** Israel clock for a future retry. A past or empty time stays silent. The next Israel date says מחר. */
export function retryClockParts(
  iso: string | null | undefined,
  now = Date.now(),
): { clock: string; tomorrow: boolean } | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || at <= now) return null;
  const zone = "Asia/Jerusalem";
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return { clock, tomorrow: day.format(new Date(at)) !== day.format(new Date(now)) };
}

export function retryClock(iso: string | null | undefined, now = Date.now()): string | null {
  const parts = retryClockParts(iso, now);
  if (!parts) return null;
  return parts.tomorrow ? `אפשר לנסות שוב מחר ב-${parts.clock}` : `אפשר לנסות שוב ב-${parts.clock}`;
}
