import { HEBREW_MONTHS, formatDisplay, israelToday, monthSpan, previousMonthSpan, yearSpan } from "./ui/date-math";

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

/** The word matches the figure. A loss says הפסד. החודש is named when that period is selected. */
export function heroProfitLabel(period: PeriodChoice, profitAgorot: bigint): string {
  const word = profitAgorot < 0n ? "הפסד" : "רווח נקי";
  switch (period.kind) {
    case "month":
      return `${word} החודש`;
    case "lastMonth":
      return `${word} בחודש קודם`;
    case "ytd":
      return `${word} מתחילת השנה`;
    case "all":
      return `${word} בכל התקופה`;
    case "custom":
      return `${word} בטווח שנבחר`;
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}

function hebrewDay(iso: string, now: Date): string {
  const day = String(Number(iso.slice(8, 10)));
  const month = HEBREW_MONTHS[Number(iso.slice(5, 7)) - 1] ?? "";
  const spoken = `${day} ב${month}`;
  const year = iso.slice(0, 4);
  if (year !== israelToday(now).slice(0, 4)) return `${spoken} ${year}`;
  return spoken;
}

/** One plain line for the hero. A range that ends today says עד היום. */
export function heroExplanation(period: PeriodChoice, now = new Date()): string {
  const lead = "הכנסות פחות הוצאות";
  if (period.kind === "all" || period.from == null) return `${lead}, בכל התקופה`;
  const today = israelToday(now);
  const start = hebrewDay(period.from, now);
  const end = period.to == null || period.to === today ? "היום" : hebrewDay(period.to, now);
  return `${lead}, מ־${start} עד ${end}`;
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
