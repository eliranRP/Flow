const SUMIT_ERRORS: Record<string, string> = {
  unauthorized: "אין הפעלה מחוברת.",
  "no company": "עדיין אין עסק על החשבון.",
  "company id and api key are required": "צריך מזהה חברה ומפתח.",
  "could not store the connection": "לא הצלחנו לשמור את החיבור.",
  "SUMIT is not connected": "SUMIT לא מחובר.",
  sync_failed: "הרענון נכשל. נסו שוב.",
  rate_limited: "הרענון נכשל. נסו שוב.",
  sumit_rejected: "SUMIT לא זמין כרגע.",
  sumit_auth: "החיבור ל־SUMIT נכשל.",
  sync_page_cap: "יש יותר מדי מסמכים לרענון אחד. פנו לתמיכה.",
  sync_skipped: "הרענון דילג. אפשר שוב בעוד דקה.",
  sync_sweep_empty: "הרענון הגיע בלי מסמכים, אז הספרים לא נמחקו.",
  sync_sweep_suspicious: "הרענון נראה חלקי, אז מסמכים ישנים לא נמחקו.",
  connect_failed: "לא הצלחנו להתחבר. נסו שוב.",
  method: "החיבור נכשל.",
};

/** Hebrew for a known SUMIT code. An unknown code becomes the generic sentence. */
export function hebrewSumitError(code: string | null | undefined): string | null {
  if (!code) return null;
  return SUMIT_ERRORS[code] ?? "החיבור נכשל. נסו שוב.";
}

function israelDayKey(at: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/** The previous Israel calendar day. A 24-hour step that lands on today steps again. */
function previousIsraelDay(now: number): string {
  const today = israelDayKey(now);
  let probe = now - 24 * 60 * 60 * 1000;
  if (israelDayKey(probe) === today) probe -= 24 * 60 * 60 * 1000;
  return israelDayKey(probe);
}

/**
 * Last-sync phrase in Israel time. Today is a clock, yesterday names אתמול,
 * and an older day is D.M. An unreadable time stays silent.
 */
export function israelSyncPhrase(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const clock = israelClock(iso);
  const day = israelDayKey(at);
  if (clock == null) return null;
  if (day === israelDayKey(now)) return `עודכן ב-${clock}`;
  if (day === previousIsraelDay(now)) return `עודכן אתמול ב-${clock}`;
  const [, month, date] = day.split("-");
  return `עודכן ב-${String(Number(date))}.${String(Number(month))}`;
}

/** Israel clock, HH:MM. An unreadable time stays silent. */
export function israelClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
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
  const clock = israelClock(iso);
  if (clock == null) return null;
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
