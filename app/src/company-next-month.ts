import { formatAmountText, type CategoryRow, type ExpectedParty, type ProjectCategoryMonths } from "@flow/shared";
import { incomeNote, isRent, type RentCategory } from "./next-month-chart";
import { monthWord } from "./project-next-edit";
import type { ForecastLoan } from "./project-next-loans";
import { applyForecastEdits, cashForecast, nextMonthForecast, nextMonthKey, type NextMonthForecast, type NextMonthRow, type ProjectForecastEdit } from "./project-next-month";

/**
 * The company's forecast for next month (canvas note spec-fcwide, item 2; decision 0196 point 5), pure: the
 * sum of every project's forecast, as its צפי page builds it (nextMonthForecast with the project's edits on
 * top), plus the general costs: the recurring charges, loans and category averages with no project, built the
 * same way. Profit terms, in one currency (the company's). The reads are the company's at once: expected_months
 * and the loans for every project, and company_next_month_inputs for the category months and the edits.
 */

/** One category's months as company_next_month_inputs gives them (the fields the averages read). */
export type CategoryMonthsRow = { id: string | null; name: string | null; currency: string; months_minor: number[] };

/** An edit with the project it belongs to. */
export type CompanyForecastEdit = ProjectForecastEdit & { project_id: string };

/** company_next_month_inputs, parsed. */
export type CompanyNextMonthInputs = {
  /** yyyy-mm, next month. */
  month: string;
  /** The company's overhead project: its charges, loans and edits are general costs, never a project of its own. */
  overhead_project_id: string | null;
  /** The active projects but the overhead one (a finished project projects nothing). */
  projects: { project_id: string; categories: CategoryMonthsRow[] }[];
  /**
   * The months of the expense lines with no project, or overhead, less the lines of a recurring charge that a
   * project's part counts (its party's closest project), so no stream is both a charge and an average.
   */
  general: CategoryMonthsRow[];
  edits: CompanyForecastEdit[];
  /**
   * The later months' edits (decision 0200; FLOW-1066, decision 0260: every month of the forecast, next month to
   * forecastLastMonth, no longer only the rest of the year): every edit that applies to any of them, an added one
   * with its matched line by month. Older payloads and fixtures omit it: next month's `edits` stand in. FLOW-1171:
   * the read leaves it out (p_rest false) for next month's own card, which builds from `edits`.
   */
  rest_edits?: RestOfYearEdit[];
};

/** A rest-of-year edit: `matches` is its matched bank line by month (yyyy-mm), for an added line. */
export type RestOfYearEdit = Omit<CompanyForecastEdit, "matched_transaction_id"> & { matches?: Record<string, string> };

/** One part of the sum: a project's forecast, or the general costs' (`projectId` null). */
/** `skipped` (FLOW-1079): the part's rows taken out of this month only from Home or a charge's page, by row key. */
export type CompanyForecastPart = { projectId: string | null; forecast: NextMonthForecast; skipped?: readonly string[] };

export type CompanyNextMonth = {
  /** yyyy-mm */
  month: string;
  /** Positive totals: the parts' totals summed. */
  incomeMinor: bigint;
  expenseMinor: bigint;
  netMinor: bigint;
  /** Every part's rows, each with its project (null for the general costs). */
  rows: (NextMonthRow & { projectId: string | null })[];
  /** The parts with at least one row, projects first in id order, the general costs last. */
  parts: CompanyForecastPart[];
  /**
   * FLOW-1096: every part's rows taken out of the month (FLOW-1079), with the part's project, a part left with no
   * row included, so what was taken out can still be put back.
   */
  skipped: { projectId: string | null; row: NextMonthRow }[];
  /**
   * FLOW-1096: the parties split by project (`party:<direction>:<party>:<currency>`, more than one charge in the
   * currency, as the month forecast keys them), so a month to come keys a charge as this month does.
   */
  splitKeys: ReadonlySet<string>;
};

/**
 * The general costs run through the project builder under this key: their charges, loans and months carry no
 * project, and the builder picks a project's own by an equal id.
 */
const GENERAL = "";

/** A project's months in the shape the builder reads (the flags and medians the averages ignore left empty). */
function asCategoryMonths(projectId: string, rows: readonly CategoryMonthsRow[]): ProjectCategoryMonths {
  return {
    project_id: projectId,
    today: "",
    this_month: "",
    months: [],
    categories: rows.map((row) => ({
      ...row,
      group_name: null,
      this_month_minor: 0,
      months_seen: 0,
      expected_minor: null,
      typical_day: null,
      flag: null,
    })),
  };
}

/**
 * Next month for the whole company: each active project's forecast (its recurring charges, loans and averages,
 * the project's edits on top) and the general costs' (with the overhead project's), summed. A project with
 * nothing expected adds nothing.
 */
/** What the company's forecast is built from. */
export type CompanyForecastInput = {
  currency: string;
  today: string;
  /** expected_months for the whole company: every charge with its project (null for none). */
  recurring: readonly ExpectedParty[];
  /** Every loan of the company with its project (null for none). */
  loans: readonly ForecastLoan[];
  categories: readonly Pick<CategoryRow, "id" | "name" | "loan_part" | "excluded_from_pnl">[];
  inputs: CompanyNextMonthInputs;
  /** yyyy-mm, a later month of the forecast (decision 0200, FLOW-1066: companyMonthInput); default next month. */
  month?: string;
  /**
   * FLOW-1079: the month's forecast items taken out for that month only (forecast_overrides with moved_out, keys
   * `party:<direction>:<party>:<currency>[:<project|none>]`). Each takes the charge's row out of its part.
   */
  skips?: readonly string[];
};

/**
 * FLOW-1079: a month's skips as one-month removals of a part's recurring rows (`rec:<direction>:<party>`). A key
 * with no project is the party's in every part; with one, only in that project's part (`none` or the overhead
 * project: the general costs). Ids start `skip:`, so the part can tell them from the project page's own removals.
 */
export function skipEdits(skips: readonly string[] | undefined, projectId: string | null, overhead: string | null, month: string): ProjectForecastEdit[] {
  return (skips ?? []).flatMap((key): ProjectForecastEdit[] => {
    const [kind, direction, party, , project] = key.split(":");
    if (kind !== "party" || (direction !== "income" && direction !== "expense") || party == null || party === "") return [];
    const general = projectId == null;
    if (project != null && !(general ? project === "none" || project === overhead : project === projectId)) return [];
    return [{ id: `skip:${key}`, kind: "remove", row_key: `rec:${direction}:${party}`, category_id: null, direction: null, amount_minor: null, pace: "once", start_month: month }];
  });
}

/** The row keys a part's skips took out. */
function skippedRows(forecast: NextMonthForecast): string[] {
  return (forecast.skipped ?? []).map((row) => row.key);
}

export function companyNextMonthForecast(input: CompanyForecastInput): CompanyNextMonth {
  const month = input.month ?? nextMonthKey(input.today);
  const overhead = input.inputs.overhead_project_id;
  const build = (projectId: string, rows: readonly CategoryMonthsRow[], recurring: readonly ExpectedParty[], loans: readonly ForecastLoan[]) => nextMonthForecast({
    projectId,
    currency: input.currency,
    today: input.today,
    recurring,
    categoryMonths: asCategoryMonths(projectId, rows),
    loans,
    categories: input.categories,
    month,
  });
  // Only the projects the read lists: a finished project's charges, loans and edits add nothing.
  const parts: CompanyForecastPart[] = input.inputs.projects
    .filter((project) => project.project_id !== overhead)
    .map((project) => project.project_id)
    .sort()
    .map((projectId) => {
      const skips = skipEdits(input.skips, projectId, overhead, month);
      const forecast = applyForecastEdits(
        build(projectId, input.inputs.projects.find((project) => project.project_id === projectId)?.categories ?? [], input.recurring, input.loans),
        [...input.inputs.edits.filter((edit) => edit.project_id === projectId), ...skips],
      );
      return { projectId, forecast, skipped: skippedRows(forecast) };
    });
  const general = companyGeneralForecast(input, month);
  parts.push({ projectId: null, forecast: general, skipped: skippedRows(general) });
  const kept = parts.filter((part) => part.forecast.rows.length > 0);
  const incomeMinor = kept.reduce((sum, part) => sum + part.forecast.incomeMinor, 0n);
  const expenseMinor = kept.reduce((sum, part) => sum + part.forecast.expenseMinor, 0n);
  return {
    month,
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    rows: kept.flatMap((part) => part.forecast.rows.map((row) => ({ ...row, projectId: part.projectId }))),
    parts: kept,
    skipped: parts.flatMap((part) => (part.forecast.skipped ?? []).map((row) => ({ projectId: part.projectId, row }))),
    splitKeys: splitPartyKeys(input.recurring),
  };
}

/** FLOW-1096: the parties with more than one charge in a currency, as the month forecast splits them (decision 0185). */
export function splitPartyKeys(recurring: readonly Pick<ExpectedParty, "direction" | "party_id" | "currency">[]): Set<string> {
  const charges = new Map<string, number>();
  for (const party of recurring) {
    const base = `party:${party.direction}:${party.party_id}:${party.currency}`;
    charges.set(base, (charges.get(base) ?? 0) + 1);
  }
  return new Set([...charges].filter(([, count]) => count > 1).map(([base]) => base));
}

/**
 * FLOW-990: the company's next month in cash terms (decision 0196), as Home and the Projects tab show it: each
 * part's loans' principal due next month added (cashForecast), the totals summed again. The rows stay as they are.
 */
export function companyCashForecast(forecast: CompanyNextMonth): CompanyNextMonth {
  const parts = forecast.parts.map((part) => ({ ...part, forecast: cashForecast(part.forecast) }));
  const expenseMinor = parts.reduce((sum, part) => sum + part.forecast.expenseMinor, 0n);
  return { ...forecast, parts, expenseMinor, netMinor: forecast.incomeMinor - expenseMinor };
}

/**
 * FLOW-1002: the general costs' part on its own (what carries no project and what the overhead project carries),
 * with the overhead project's edits, even when it expects nothing. The company sums it with the projects'; the
 * overhead project's own צפי page, its edit page and its card show it, so a general row is edited like any
 * project's row.
 */
export function companyGeneralForecast(input: CompanyForecastInput, month = input.month ?? nextMonthKey(input.today)): NextMonthForecast {
  const overhead = input.inputs.overhead_project_id;
  // Its lines are already in the general months; built as one part under the builder's own project key, so a
  // category one of their charges or loans fills is never also averaged.
  const general = (projectId: string | null | undefined) => projectId == null || projectId === overhead;
  const recurring = input.recurring.filter((party) => general(party.project_id)).map((party) => ({ ...party, project_id: GENERAL }));
  const loans = input.loans.filter((loan) => general(loan.projectId)).map((loan) => ({ ...loan, projectId: GENERAL }));
  return applyForecastEdits(
    nextMonthForecast({
      projectId: GENERAL,
      currency: input.currency,
      today: input.today,
      recurring,
      categoryMonths: asCategoryMonths(GENERAL, input.inputs.general),
      loans,
      categories: input.categories,
      month,
    }),
    [...input.inputs.edits.filter((edit) => overhead != null && edit.project_id === overhead), ...skipEdits(input.skips, null, overhead, month)],
  );
}

/** The card's grey corner caption: "7 פרויקטים וכללי", what the sum is made of. */
export function companyForecastCaption(forecast: Pick<CompanyNextMonth, "parts">): string {
  const projects = forecast.parts.filter((part) => part.projectId != null).length;
  const general = forecast.parts.some((part) => part.projectId == null);
  const named = projects === 0 ? "" : projects === 1 ? "פרויקט אחד" : `${String(projects)} פרויקטים`;
  if (named === "") return general ? "כללי" : "";
  return general ? `${named} וכללי` : named;
}

/**
 * Under הכנסות צפויות: rent and other income named apart, "6 שכירויות ו־2 הכנסות", when both are expected;
 * otherwise the project card's caption (incomeNote: "6 שכירויות קבועות", "2 הכנסות קבועות", a name, a count).
 */
export function companyIncomeNote(forecast: Pick<CompanyNextMonth, "rows">, categories: readonly RentCategory[]): string {
  const income = forecast.rows.filter((row) => row.minor > 0n);
  const rent = income.filter((row) => row.kind === "recurring" && isRent(row.categoryId, categories)).length;
  const other = income.length - rent;
  if (rent === 0 || other === 0) return incomeNote(forecast, categories);
  const rentWords = rent === 1 ? "שכירות אחת" : `${String(rent)} שכירויות`;
  // "ו־" before a figure, "ו" joined to a word.
  return other === 1 ? `${rentWords} והכנסה אחת` : `${rentWords} ו־${String(other)} הכנסות`;
}

/** Under הוצאות צפויות: "מול $25,060 באוקטובר", this month's counted expenses so far (the board's company card). */
export function companyExpenseNote(forecast: Pick<CompanyNextMonth, "expenseMinor">, thisMonth: string, thisMonthExpense: bigint, currency: string): string {
  if (forecast.expenseMinor === 0n) return "אין הוצאות צפויות";
  return `מול ${formatAmountText(thisMonthExpense, currency)} ב${monthWord(thisMonth)}`;
}
