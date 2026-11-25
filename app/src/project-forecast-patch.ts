import type { ForecastOverrideRow } from "@flow/shared";
import { incomeFactsOf, type IncomeFacts, type RentCategory } from "./next-month-chart";
import { orderRows } from "./company-forecast-map";
import type { ProjectForecastRead } from "./project-forecast-map";
import type { NextMonthRow } from "./project-next-month";

/**
 * FLOW-1315: a tap's effect on a project forecast the app already holds, drawn at once without a read: a skip, its undo or a reset
 * (the month forecast's `set_forecast_item`, written from the צפי page, Home and the charge's page) and the project page's own
 * removal of a row. The same rules the database applies: a skip is a one-month removal of the party's row (`rec:<direction>:<party>`,
 * skipEdits), a row goes to the list apart with its amount out of the totals, and back again in the builders' order. What no row
 * holds (a loan's cash, which a removal of its every row takes out) follows with the read after the project page's own removal (a skip removes one row, and no
 * loan's cash with it, so a skip reads nothing, FLOW-1323).
 */

/** The row a skip key (`party:<direction>:<party>:<currency>[:<project|none>]`) takes out of a project's page, or null when it is not this page's. */
export function skippedRowKey(key: string, projectId: string, general: boolean): string | null {
  const [kind, direction, party, , project] = key.split(":");
  if (kind !== "party" || (direction !== "income" && direction !== "expense") || party == null || party === "") return null;
  if (project != null && !(general ? project === "none" || project === projectId : project === projectId)) return null;
  return `rec:${direction}:${party}`;
}

/** The keys the month's overrides take out of the forecast. */
export function skippedKeysOf(read: Pick<ProjectForecastRead, "overrides">): string[] {
  return read.overrides.filter((row) => row.moved_out).map((row) => row.item_key);
}

function withoutRow(rows: readonly NextMonthRow[], key: string): { rest: NextMonthRow[]; row: NextMonthRow | undefined } {
  return { rest: rows.filter((row) => row.key !== key), row: rows.find((row) => row.key === key) };
}

/**
 * What the card's income note reads, for the rows now counted: from the company's categories when held. Without them, rent is
 * known only when the rows were all rent or none were (then so are the rows that moved), else it stays as it was, never above the recurring rows.
 */
function factsOf(rows: readonly NextMonthRow[], before: IncomeFacts, categories: readonly RentCategory[] | undefined): IncomeFacts {
  const facts = incomeFactsOf(rows, categories ?? []);
  if (categories != null) return facts;
  const rent = before.rent === before.recurring ? facts.recurring : before.rent === 0 ? 0 : Math.min(before.rent, facts.recurring);
  return { ...facts, rent };
}

/** The forecast with `rows` counted: the totals follow them, the loans' cash (no row holds it) stays. */
function counted(read: ProjectForecastRead, rows: NextMonthRow[], apart: { removed?: NextMonthRow[]; skipped?: NextMonthRow[] }, categories: readonly RentCategory[] | undefined): ProjectForecastRead {
  const incomeMinor = rows.reduce((sum, row) => (row.minor > 0n ? sum + row.minor : sum), 0n);
  const expenseMinor = rows.reduce((sum, row) => (row.minor < 0n ? sum - row.minor : sum), 0n);
  return {
    ...read,
    forecast: {
      ...read.forecast,
      rows,
      incomeMinor,
      expenseMinor,
      netMinor: incomeMinor - expenseMinor,
      loanCount: rows.filter((row) => row.kind === "loan").length,
      removed: apart.removed ?? read.forecast.removed,
      skipped: apart.skipped ?? read.forecast.skipped ?? [],
    },
    income: factsOf(rows, read.income, categories),
  };
}

/**
 * The project page takes a row out of the month (remove_project_forecast_row): it leaves the rows for the removed ones, and the
 * edit it writes starts in this month, so the reset button shows. A loan's row takes its cash out too when it was the loan's
 * last, which the answer cannot say (it holds no cash by loan): the cash figures are pending until the read after the write.
 */
export function withRowRemoved(read: ProjectForecastRead, rowKey: string, categories?: readonly RentCategory[]): ProjectForecastRead {
  const { rest, row } = withoutRow(read.forecast.rows, rowKey);
  if (row == null) return read;
  return { ...counted(read, rest, { removed: orderRows([...read.forecast.removed, row]) }, categories), edited: true, cashPending: read.cashPending || row.kind === "loan" };
}

/**
 * Skips added to and taken off the month, in the override rows and in the rows: a row a new skip takes out moves to the skipped
 * ones, one a lifted skip had taken out moves back. A row the project page removed stays removed either way.
 */
export function withSkipsChanged(read: ProjectForecastRead, projectId: string, change: { added: readonly string[]; removed: readonly string[] }, categories?: readonly RentCategory[]): ProjectForecastRead {
  const overrides: ForecastOverrideRow[] = read.overrides.map((row) => (change.removed.includes(row.item_key) ? { ...row, moved_out: false } : row));
  for (const key of change.added) {
    const at = overrides.findIndex((row) => row.item_key === key);
    const held = at < 0 ? undefined : overrides[at];
    if (held == null) overrides.push({ item_key: key, amount_minor: null, due_on: null, moved_out: true });
    else overrides[at] = { ...held, moved_out: true };
  }
  let rows = read.forecast.rows;
  let skipped = read.forecast.skipped ?? [];
  for (const key of change.added) {
    const rowKey = skippedRowKey(key, projectId, read.general);
    const out = rowKey == null ? undefined : withoutRow(rows, rowKey);
    if (out?.row == null) continue;
    rows = out.rest;
    skipped = orderRows([...skipped, out.row]);
  }
  for (const key of change.removed) {
    const rowKey = skippedRowKey(key, projectId, read.general);
    const back = rowKey == null ? undefined : withoutRow(skipped, rowKey);
    if (back?.row == null) continue;
    skipped = back.rest;
    rows = orderRows([...rows, back.row]);
  }
  return counted({ ...read, overrides }, rows, { skipped }, categories);
}
