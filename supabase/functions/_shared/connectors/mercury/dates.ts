/** Add calendar days to a YYYY-MM-DD date. The arithmetic is on the UTC calendar, so a DST change does not shift the day. */
export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match || !Number.isInteger(days)) throw new Error("bad date");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Calendar date of an instant in Asia/Jerusalem. */
export function jerusalemDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error("bad timestamp");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("bad timestamp");
  return `${year}-${month}-${day}`;
}
