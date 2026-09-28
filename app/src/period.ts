import type { Basis } from "@flow/shared";

export interface PeriodChoice {
  from: string | null;
  to: string | null;
  label: string;
  basis: Basis;
}

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
  return { from: `${today.slice(0, 8)}01`, to: today, label: "החודש", basis: "cash" };
}

export function lastMonth(now = new Date()): PeriodChoice {
  const today = israelToday(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const start = `${String(previous.year)}-${String(previous.month).padStart(2, "0")}-01`;
  const endDay = new Date(Date.UTC(previous.year, previous.month, 0)).getUTCDate();
  const end = `${String(previous.year)}-${String(previous.month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return { from: start, to: end, label: "חודש קודם", basis: "cash" };
}

export function yearToDate(now = new Date()): PeriodChoice {
  const today = israelToday(now);
  return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "מתחילת השנה", basis: "cash" };
}

export function allTime(basis: Basis = "cash"): PeriodChoice {
  return { from: null, to: null, label: "כל התקופה", basis };
}
