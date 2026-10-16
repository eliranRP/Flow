import type { RecurringPace } from "@flow/shared";

/**
 * FLOW-447: the pure layout rules of the קבועים list and its charge rows, apart from the screen so the
 * numbers the board shows are unit-tested. Amounts are whole minor units, unsigned; the screen adds signs.
 */

/** One charge on the list: the usual amount, or the amount it arrived at once it has. */
export type RecurringLine = {
  id: string;
  income: boolean;
  /** The category's name, or null when the charge files to none. */
  category: string | null;
  pace: RecurringPace;
  /** The usual amount: what a month of this charge costs, whether or not it has arrived. */
  usual: bigint;
  /** The amount this month: the arrived amount once it has come, else the usual one. */
  minor: bigint;
  /** Paid this month (an expense or income that came in). */
  arrived: boolean;
  /** Still to come this month, or already due in it; a charge due in a later month is false. */
  due: boolean;
  /** The day of the month it comes, for the order inside a group. */
  day: number;
};

/** How many months one payment covers at each pace: a bill every 2 months is half a month, a year a twelfth. */
const PACE_MONTHS: Record<RecurringPace, bigint> = { month: 1n, "2months": 2n, quarter: 3n, year: 12n };

/** The monthly cost of one charge: its amount over the months it covers, rounded half up. */
export function monthlyCostMinor(minor: bigint, pace: RecurringPace): bigint {
  const months = PACE_MONTHS[pace];
  return (minor + months / 2n) / months;
}

/**
 * The card's "יוצא החודש": every expense that arrived this month at its amount, plus every expense due
 * this month that has not arrived yet at its usual amount. Income is left out.
 */
export function monthOutflow(lines: readonly RecurringLine[]): { total: bigint; paid: bigint; toCome: bigint } {
  let paid = 0n;
  let toCome = 0n;
  for (const line of lines) {
    if (line.income) continue;
    if (line.arrived) paid += line.minor;
    else if (line.due) toCome += line.minor;
  }
  return { total: paid + toCome, paid, toCome };
}

/** The order inside a group: paid first, then still to come, then later; by day within each. */
export function compareInGroup(a: RecurringLine, b: RecurringLine): number {
  return rankInGroup(a) - rankInGroup(b) || a.day - b.day;
}

function rankInGroup(line: RecurringLine): number {
  if (line.arrived) return 0;
  return line.due ? 1 : 2;
}

export type RecurringGroup = {
  /** The category's name, or the label for charges with none. */
  name: string;
  income: boolean;
  /** The sum of each charge's monthly cost at its usual amount: "לחודש" on the group head, signed "+" for income. */
  monthlyMinor: bigint;
  lines: RecurringLine[];
};

/** The label of charges that file to no category; it sorts last among the expense groups. */
export const NO_CATEGORY = "ללא קטגוריה";

/**
 * One group per category, in the order the categories first appear in `lines` (the caller sorts them
 * by the server's order), with income last and "ללא קטגוריה" last among the expenses.
 */
export function groupRecurring(lines: readonly RecurringLine[]): RecurringGroup[] {
  const groups = new Map<string, RecurringGroup>();
  for (const line of lines) {
    const name = line.category ?? NO_CATEGORY;
    const key = `${line.income ? "in" : "out"}:${name}`;
    let group = groups.get(key);
    if (group == null) {
      group = { name, income: line.income, monthlyMinor: 0n, lines: [] };
      groups.set(key, group);
    }
    group.lines.push(line);
    group.monthlyMinor += monthlyCostMinor(line.usual, line.pace);
  }
  const ordered = [...groups.values()].map((group) => ({ ...group, lines: [...group.lines].sort(compareInGroup) }));
  return [
    ...ordered.filter((group) => !group.income && group.name !== NO_CATEGORY),
    ...ordered.filter((group) => !group.income && group.name === NO_CATEGORY),
    ...ordered.filter((group) => group.income),
  ];
}
