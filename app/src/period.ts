import { HEBREW_MONTHS, formatDisplay, israelToday, pad } from "./ui/date-math";

/**
 * The period presets on the period bar (profit by period, option A, decision 0141), plus a
 * custom range from the period sheet. "month", "months3" and "months6" end with their anchor
 * month; "year" is a calendar year. Every window is cut at today, so the open month counts.
 */
export type PeriodKind = "month" | "months3" | "months6" | "year" | "all" | "custom";

export type PresetKind = Exclude<PeriodKind, "custom">;

export const PRESET_KINDS: readonly PresetKind[] = ["month", "months3", "months6", "year", "all"];

/** Identity is the kind and the anchor, plus the dates when the kind is custom. The label is derived. */
export interface PeriodChoice {
  kind: PeriodKind;
  from: string | null;
  to: string | null;
  /** yyyy-mm, the last month of a stepped window. Omitted means the window that ends now. */
  anchor?: string | null;
}

/** Where a period is shown. On a project, הכול reads מתחילת הפרויקט (FLOW-411). */
export type PeriodScope = "company" | "project";

const STEP_MONTHS: Record<"month" | "months3" | "months6" | "year", number> = {
  month: 1,
  months3: 3,
  months6: 6,
  year: 12,
};

function monthKey(now: Date): string {
  return israelToday(now).slice(0, 7);
}

export function shiftMonthKey(key: string, delta: number): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7)) - 1;
  const date = new Date(Date.UTC(year, month + delta, 1));
  return `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}`;
}

function lastDay(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${key}-${pad(day)}`;
}

function monthName(key: string): string {
  return HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? "";
}

function validKey(key: string | null | undefined): key is string {
  return key != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

/** The window's last month. A year anchors on its December. */
export function anchorOf(period: PeriodChoice, now = new Date()): string {
  if (validKey(period.anchor)) return period.anchor;
  if (period.to && validKey(period.to.slice(0, 7))) {
    return period.kind === "year" ? `${period.to.slice(0, 4)}-12` : period.to.slice(0, 7);
  }
  const current = monthKey(now);
  return period.kind === "year" ? `${current.slice(0, 4)}-12` : current;
}

/** A preset window. Without an anchor it ends with the current month. Never past today. */
export function presetPeriod(kind: PresetKind, now = new Date(), anchor?: string | null): PeriodChoice {
  if (kind === "all") return { kind: "all", from: null, to: null };
  const today = israelToday(now);
  const current = monthKey(now);
  let end = validKey(anchor) ? anchor : kind === "year" ? `${current.slice(0, 4)}-12` : current;
  if (kind === "year") end = `${end.slice(0, 4)}-12`;
  if (kind !== "year" && end > current) end = current;
  if (kind === "year" && end.slice(0, 4) > current.slice(0, 4)) end = `${current.slice(0, 4)}-12`;
  const start = kind === "year" ? `${end.slice(0, 4)}-01` : shiftMonthKey(end, 1 - STEP_MONTHS[kind]);
  const lastIso = lastDay(end);
  return { kind, from: `${start}-01`, to: lastIso > today ? today : lastIso, anchor: end };
}

export function thisMonth(now = new Date()): PeriodChoice {
  return presetPeriod("month", now);
}

/** Home opens on the last 3 months, to date (plan open question 1). */
export function defaultPeriod(now = new Date()): PeriodChoice {
  return presetPeriod("months3", now);
}

export function allTime(): PeriodChoice {
  return { kind: "all", from: null, to: null };
}

export function customRange(from: string, to: string): PeriodChoice {
  return { kind: "custom", from, to };
}

/** One calendar month as a period, as the "לפי חודש" list opens it. */
export function monthPeriod(key: string, now = new Date()): PeriodChoice {
  return presetPeriod("month", now, key);
}

export function canStep(period: PeriodChoice): boolean {
  return period.kind === "month" || period.kind === "months3" || period.kind === "months6" || period.kind === "year";
}

/** True when the window ends with the current month (or year), so the later arrow is off. */
export function isCurrentPeriod(period: PeriodChoice, now = new Date()): boolean {
  if (!canStep(period)) return true;
  const current = monthKey(now);
  const anchor = anchorOf(period, now);
  if (period.kind === "year") return anchor.slice(0, 4) >= current.slice(0, 4);
  return anchor >= current;
}

/**
 * The window one step earlier (-1) or later (+1), by the preset's own length. A year steps by
 * calendar year. Null when the period has no arrows or the step would pass the current period.
 */
export function stepPeriod(period: PeriodChoice, delta: -1 | 1, now = new Date()): PeriodChoice | null {
  if (!canStep(period)) return null;
  if (delta > 0 && isCurrentPeriod(period, now)) return null;
  const kind = period.kind as "month" | "months3" | "months6" | "year";
  const next = shiftMonthKey(anchorOf(period, now), delta * STEP_MONTHS[kind]);
  return presetPeriod(kind, now, next);
}

export function samePeriod(left: PeriodChoice, right: PeriodChoice, now = new Date()): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "all") return true;
  if (left.kind === "custom") return left.from === right.from && left.to === right.to;
  return anchorOf(left, now) === anchorOf(right, now);
}

/** The preset's name on the segmented control. */
export function presetLabel(kind: PresetKind): string {
  switch (kind) {
    case "month":
      return "חודש";
    case "months3":
      return "3 חודשים";
    case "months6":
      return "6 חודשים";
    case "year":
      return "שנה";
    case "all":
      return "הכול";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** Under 360px the two long presets shorten (plan §7). */
export function presetShortLabel(kind: PresetKind): string {
  if (kind === "months3") return "3 ח׳";
  if (kind === "months6") return "6 ח׳";
  return presetLabel(kind);
}

/** The stepper label: the window's months, the year, or the custom dates. */
export function windowLabel(period: PeriodChoice, now = new Date(), scope: PeriodScope = "company"): string {
  switch (period.kind) {
    case "all":
      return scope === "project" ? "מתחילת הפרויקט" : "כל התקופה";
    case "custom":
      if (period.from && period.to) return `${formatDisplay(period.from)} – ${formatDisplay(period.to)}`;
      return "טווח מותאם";
    case "year":
      return anchorOf(period, now).slice(0, 4);
    case "month": {
      const key = anchorOf(period, now);
      return `${monthName(key)} ${key.slice(0, 4)}`;
    }
    case "months3":
    case "months6": {
      const end = anchorOf(period, now);
      const start = period.from && validKey(period.from.slice(0, 7))
        ? period.from.slice(0, 7)
        : shiftMonthKey(end, 1 - STEP_MONTHS[period.kind]);
      if (start.slice(0, 4) === end.slice(0, 4)) return `${monthName(start)} – ${monthName(end)} ${end.slice(0, 4)}`;
      return `${monthName(start)} ${start.slice(0, 4)} – ${monthName(end)} ${end.slice(0, 4)}`;
    }
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}

/** The window reaches today, so the stepper says עד היום under its label. */
export function windowToDate(period: PeriodChoice, now = new Date()): boolean {
  if (period.kind === "all") return false;
  return period.to != null && period.to === israelToday(now);
}

/** Short words for a pill or a subtitle. החודש is named when the current month is selected. */
export function periodLabel(period: PeriodChoice, now = new Date(), scope: PeriodScope = "company"): string {
  switch (period.kind) {
    case "month":
      return isCurrentPeriod(period, now) ? "החודש" : windowLabel(period, now, scope);
    case "months3":
    case "months6":
      return isCurrentPeriod(period, now) ? presetLabel(period.kind) : windowLabel(period, now, scope);
    case "year":
    case "all":
      return windowLabel(period, now, scope);
    case "custom":
      return "טווח מותאם";
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}

/**
 * The period pill's and the Search chip's words (FLOW-351): the shared תקופה sheet's own row name
 * (חודש, 3 חודשים, 6 חודשים, שנה, הכול) while the window ends now; a window stepped back names its
 * months or year.
 */
export function periodPillLabel(period: PeriodChoice, now = new Date()): string {
  if (period.kind === "custom") return "טווח מותאם";
  return isCurrentPeriod(period, now) ? presetLabel(period.kind) : windowLabel(period, now);
}

/** The period as an adverbial phrase: החודש, בספטמבר 2026, ב־3 חודשים, ב־2026, מתחילת הפרויקט. */
export function periodPhrase(period: PeriodChoice, now = new Date(), scope: PeriodScope = "company"): string {
  switch (period.kind) {
    case "month":
      return isCurrentPeriod(period, now) ? "החודש" : `ב${windowLabel(period, now, scope)}`;
    case "months3":
    case "months6":
      return isCurrentPeriod(period, now) ? `ב־${presetLabel(period.kind)}` : `ב${windowLabel(period, now, scope)}`;
    case "year":
      return `ב־${windowLabel(period, now, scope)}`;
    case "all":
      return scope === "project" ? "מתחילת הפרויקט" : "בכל התקופה";
    case "custom":
      return "בטווח שנבחר";
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}

/** The word matches the figure. A loss says הפסד. */
export function heroProfitLabel(period: PeriodChoice, profitAgorot: bigint | "mixed", now = new Date()): string {
  // FLOW-339: a profit in one currency and a loss in another names both.
  const word = profitAgorot === "mixed" ? "רווח והפסד" : profitAgorot < 0n ? "הפסד" : "רווח";
  // FLOW-358: the period pill under the label already names a past window, a year or כל התקופה,
  // so the label is the word alone. "החודש", "ב־3 חודשים" and a custom range still add what the pill's dates don't say.
  return pillNamesPeriod(period, now) ? word : `${word} ${periodPhrase(period, now)}`;
}

function pillNamesPeriod(period: PeriodChoice, now: Date): boolean {
  switch (period.kind) {
    case "month":
    case "months3":
    case "months6":
      return !isCurrentPeriod(period, now);
    case "year":
    case "all":
      return true;
    case "custom":
      return false;
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}

/**
 * One plain line for the hero. FLOW-335: it no longer repeats the dates. The period bar names the
 * window and the label names the period, so the band says the window once, not three times.
 */
export function heroExplanation(): string {
  return "הכנסות פחות הוצאות";
}

/** The hint under a row of the period sheet. */
export function periodHint(period: PeriodChoice, now = new Date()): string | undefined {
  if (period.kind === "all") return "כל החשבוניות";
  return windowLabel(period, now);
}

/** The words after the change pill. The comparison is the window of the same length just before. */
export function comparisonWords(period: PeriodChoice, now = new Date()): string | null {
  switch (period.kind) {
    case "month":
      return isCurrentPeriod(period, now) ? "מחודש שעבר" : "מהחודש שלפניו";
    case "months3":
      return "מ־3 החודשים שלפניהם";
    case "months6":
      return "מ־6 החודשים שלפניהם";
    case "year":
      return "מהתקופה שלפניה";
    case "all":
    case "custom":
      return null;
    default: {
      const unreachable: never = period.kind;
      return unreachable;
    }
  }
}

/** The presets as the period sheet lists them: each window that ends now. */
export function presetChoices(now = new Date()): PeriodChoice[] {
  return PRESET_KINDS.map((kind) => presetPeriod(kind, now));
}

/** True when the window spans more than one calendar month, so "לפי חודש" has something to list. */
export function spansMonths(period: PeriodChoice): boolean {
  if (period.kind === "all") return true;
  if (period.from == null || period.to == null) return false;
  return period.from.slice(0, 7) !== period.to.slice(0, 7);
}

/** The period in a URL, so a project and its "לפי חודש" page can be linked and restored. */
export function periodSearch(period: PeriodChoice, now = new Date()): Record<string, string> {
  if (period.kind === "all") return { period: "all" };
  if (period.kind === "custom") return { period: "custom", from: period.from ?? "", to: period.to ?? "" };
  return { period: period.kind, at: anchorOf(period, now) };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads periodSearch back. Anything unknown or broken is null, so the caller keeps its default. */
export function periodFromSearch(params: URLSearchParams, now = new Date()): PeriodChoice | null {
  const kind = params.get("period");
  if (kind === "all") return allTime();
  if (kind === "custom") {
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    if (!DAY.test(from) || !DAY.test(to) || from > to) return null;
    return customRange(from, to);
  }
  if (kind === "month" || kind === "months3" || kind === "months6" || kind === "year") {
    const at = params.get("at");
    return presetPeriod(kind, now, validKey(at) ? at : undefined);
  }
  return null;
}
