export const HEBREW_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

export const WEEKDAY_HEADS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as const;

const WEEKDAY_NAMES = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"] as const;

export function israelToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function monthCells(year: number, monthIndex: number): string[] {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const cells: string[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(Date.UTC(year, monthIndex, i - firstWeekday + 1));
    cells.push(`${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`);
  }
  return cells;
}

export function formatDisplay(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

/** Category and day, without the year. Transaction hints use this. */
export function formatDayMonth(iso: string): string {
  const month = iso.slice(5, 7);
  const day = iso.slice(8, 10);
  if (!/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return iso;
  return `${day}/${month}`;
}

export function shiftDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function dayLabel(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const weekday = WEEKDAY_NAMES[date.getUTCDay()] ?? "";
  const monthName = HEBREW_MONTHS[date.getUTCMonth()] ?? "";
  return `${weekday} ${String(date.getUTCDate())} ב${monthName} ${String(date.getUTCFullYear())}`;
}

export function monthTitle(year: number, monthIndex: number): string {
  return `${HEBREW_MONTHS[monthIndex] ?? ""} ${String(year)}`;
}
