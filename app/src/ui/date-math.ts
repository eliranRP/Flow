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

/** Day and month. A date outside the current year keeps the year. */
export function formatDayMonth(iso: string, now = new Date()): string {
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const day = iso.slice(8, 10);
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return iso;
  if (year !== israelToday(now).slice(0, 4)) return `${day}/${month}/${year}`;
  return `${day}/${month}`;
}

export function monthSpan(now = new Date()): { from: string; to: string } {
  const today = israelToday(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

export function previousMonthSpan(now = new Date()): { from: string; to: string } {
  const today = israelToday(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const start = `${String(previous.year)}-${pad(previous.month)}-01`;
  const endDay = new Date(Date.UTC(previous.year, previous.month, 0)).getUTCDate();
  return { from: start, to: `${String(previous.year)}-${pad(previous.month)}-${pad(endDay)}` };
}

export function yearSpan(now = new Date()): { from: string; to: string } {
  const today = israelToday(now);
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

export function shiftMonth(cursor: { year: number; month: number }, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export function weeksOf(cells: string[]): string[][] {
  const weeks: string[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

export function rangeLengthLabel(days: number): string {
  if (days === 1) return "הצגת יום אחד";
  if (days > 1) return `הצגת ${String(days)} ימים`;
  return "הצגה";
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
