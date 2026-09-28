import type { Basis } from "@flow/shared";
import { formatDisplay, HEBREW_MONTHS } from "./ui/date-math";

export interface PeriodChoice {
  from: string | null;
  to: string | null;
  label: string;
  basis: Basis;
}

const INVOICED: Basis = "invoiced";

export function israelToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function thisMonth(now = new Date()): PeriodChoice {
  const today = israelToday(now);
  return { from: `${today.slice(0, 8)}01`, to: today, label: "החודש", basis: INVOICED };
}

export function lastMonth(now = new Date()): PeriodChoice {
  const today = israelToday(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const start = `${String(previous.year)}-${String(previous.month).padStart(2, "0")}-01`;
  const endDay = new Date(Date.UTC(previous.year, previous.month, 0)).getUTCDate();
  const end = `${String(previous.year)}-${String(previous.month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return { from: start, to: end, label: "חודש קודם", basis: INVOICED };
}

export function yearToDate(now = new Date()): PeriodChoice {
  const today = israelToday(now);
  return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "מתחילת השנה", basis: INVOICED };
}

export function allTime(): PeriodChoice {
  return { from: null, to: null, label: "כל התקופה", basis: INVOICED };
}

export function customRange(from: string, to: string): PeriodChoice {
  return { from, to, label: "טווח מותאם", basis: INVOICED };
}

export function heroProfitLabel(period: PeriodChoice): string {
  if (!period.from || period.label === "כל התקופה") return "רווח נקי בכל התקופה";
  if (period.label === "מתחילת השנה") return "רווח נקי מתחילת השנה";
  if (period.label === "טווח מותאם") return "רווח נקי בטווח שנבחר";
  const name = HEBREW_MONTHS[Number(period.from.slice(5, 7)) - 1] ?? "";
  return `רווח נקי ב${name}`;
}

export function periodHint(period: PeriodChoice): string | undefined {
  if (!period.from) return "כל החשבוניות";
  const month = HEBREW_MONTHS[Number(period.from.slice(5, 7)) - 1] ?? "";
  if (period.label === "החודש" || period.label === "חודש קודם") return `${month} ${period.from.slice(0, 4)}`;
  if (period.label === "מתחילת השנה") return period.from.slice(0, 4);
  if (period.to) return `${formatDisplay(period.from)} – ${formatDisplay(period.to)}`;
  return undefined;
}

export function comparisonWords(period: PeriodChoice): string | null {
  if (period.label === "החודש") return "מחודש שעבר";
  if (period.label === "חודש קודם") return "מהחודש שלפניו";
  if (period.label === "מתחילת השנה") return "מהשנה שעברה";
  return null;
}
