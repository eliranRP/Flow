import { HEBREW_MONTHS, formatDisplay, monthSpan, previousMonthSpan, yearSpan } from "./ui/date-math";

export type PeriodKind = "month" | "lastMonth" | "ytd" | "all" | "custom";

/** Identity is the kind, plus the dates when the kind is custom. The label is derived. */
export interface PeriodChoice {
  kind: PeriodKind;
  from: string | null;
  to: string | null;
}

export function periodLabel(period: PeriodChoice): string {
  switch (period.kind) {
    case "month":
      return "החודש";
    case "lastMonth":
      return "חודש קודם";
    case "ytd":
      return "מתחילת השנה";
    case "all":
      return "כל התקופה";
    case "custom":
      return "טווח מותאם";
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}

export function samePeriod(left: PeriodChoice, right: PeriodChoice): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "custom") return true;
  return left.from === right.from && left.to === right.to;
}

export function thisMonth(now = new Date()): PeriodChoice {
  const span = monthSpan(now);
  return { kind: "month", from: span.from, to: span.to };
}

export function lastMonth(now = new Date()): PeriodChoice {
  const span = previousMonthSpan(now);
  return { kind: "lastMonth", from: span.from, to: span.to };
}

export function yearToDate(now = new Date()): PeriodChoice {
  const span = yearSpan(now);
  return { kind: "ytd", from: span.from, to: span.to };
}

export function allTime(): PeriodChoice {
  return { kind: "all", from: null, to: null };
}

export function customRange(from: string, to: string): PeriodChoice {
  return { kind: "custom", from, to };
}

export function heroProfitLabel(period: PeriodChoice): string {
  switch (period.kind) {
    case "all":
      return "רווח נקי בכל התקופה";
    case "ytd":
      return "רווח נקי מתחילת השנה";
    case "custom":
      return "רווח נקי בטווח שנבחר";
    case "month":
    case "lastMonth": {
      const name = period.from ? (HEBREW_MONTHS[Number(period.from.slice(5, 7)) - 1] ?? "") : "";
      return `רווח נקי ב${name}`;
    }
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}

export function periodHint(period: PeriodChoice): string | undefined {
  switch (period.kind) {
    case "all":
      return "כל החשבוניות";
    case "month":
    case "lastMonth": {
      if (!period.from) return undefined;
      const month = HEBREW_MONTHS[Number(period.from.slice(5, 7)) - 1] ?? "";
      return `${month} ${period.from.slice(0, 4)}`;
    }
    case "ytd":
      return period.from?.slice(0, 4);
    case "custom":
      if (period.from && period.to) return `${formatDisplay(period.from)} – ${formatDisplay(period.to)}`;
      return undefined;
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}

export function comparisonWords(period: PeriodChoice): string | null {
  switch (period.kind) {
    case "month":
      return "מחודש שעבר";
    case "lastMonth":
      return "מהחודש שלפניו";
    case "ytd":
      return "מהשנה שעברה";
    case "all":
    case "custom":
      return null;
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}
