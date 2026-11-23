import type { ReadSchemas } from "./load-read-schemas";

/**
 * FLOW-1267: which reads are kept on the device, named in one place. Only the first views of Home,
 * Projects, the project page, Loans, Recurring, Profit (month, year and any dates, with the overhead project), Review's first page
 * and the forecast. No search, no sheet's read, no write result. A key names its read by shape; a
 * preview's key (anything but "off") is never kept.
 *
 * Who reads a kept key, where that is not plain from its name:
 * - "expected-months" (the company's, and each project's): Home's forecast, the forecast screen, Profit's next month
 *   (company) and the project page's forecast card (project).
 * - "categories" (list_categories): Home, the project page's forecast card, Profit's next month and the pickers.
 * - the overhead project ("company-overhead"): Profit, Recurring, Forecast and next month.
 * - "month-forecast" overrides: Home's נותר לשלם and the forecast, the project page's forecast card.
 * - "project-forecast-edits": the project page's forecast card (one project, one month) and Profit's next month
 *   (the whole company, slim answer only).
 * - "loans" "company-forecast": Profit's next month (with company_next_month_inputs and the categories).
 * - "breakdown-lines" "cash": Home's first 20 lines of a side; "project-cash-month": the project page's month lines.
 * - "dashboard" "cash-to-day" and "weekly-summary": Home's change pills and its weekly card.
 * - "transfer-match-count" and "utility-refund-count": Home's דורש טיפול rows. (The Jev count is Review's, FLOW-1272.)
 * Keys that name a day (cash-to-day, category months, the company inputs) are read again on another day, so a kept
 * row serves a repeat visit on the same day only.
 */
export type KeptRule = {
  name: string;
  match: (key: readonly unknown[]) => boolean;
  /**
   * Whether the kept data still fits what the read returns. A read with a shared schema is checked
   * against it (on the data's JSON form: bigints as digit strings, as the server sends them); the
   * others by their shape. Without the schemas loaded, a schema check fails.
   */
  valid: (schemas: ReadSchemas | null, json: unknown) => boolean;
  /** Whether this read's data is worth keeping now (Review keeps its first page only). */
  keep?: (data: unknown) => boolean;
  /** Kept when the page writes it by hand too (Review's list state beside its rows). */
  manual?: boolean;
  /**
   * A hand-written copy is kept only while the read at this key is under way, begun for the owner who writes it:
   * the page writes it from inside that read, and a company switch does not stop the read.
   */
  pair?: (key: readonly unknown[]) => readonly unknown[];
  /** What a restored copy becomes: a load that was under way when it was kept is not under way now. */
  restore?: (data: unknown) => unknown;
};

type SchemaOf = (schemas: ReadSchemas) => { safeParse: (value: unknown) => { success: boolean } };

const bySchema = (pick: SchemaOf): KeptRule["valid"] => (schemas, json) => schemas != null && pick(schemas).safeParse(json).success;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isRows = (value: unknown, field: string): boolean => Array.isArray(value) && value.every((row) => isRecord(row) && typeof row[field] === "string");

const isMinorString = (value: unknown): boolean => typeof value === "string" && /^-?\d+$/.test(value);
const off = (key: readonly unknown[], at: number): boolean => key[at] === "off";
const rule = (name: string, match: KeptRule["match"], valid: KeptRule["valid"], more: Partial<KeptRule> = {}): KeptRule => ({ name, match, valid, ...more });

/** Review's first page: the rows the queue had after its first read, and no more. */
export const KEPT_REVIEW_ROWS = 50;
/** The project page's month lines are kept when they are no more than this (both lists together); a bigger month waits for its read. */
export const KEPT_PROJECT_LINES = 100;

/** The lines read of a project's month: its counted and kept-out rows, each list as cash_month_lines gives its rows. */
function projectLinesValid(schemas: ReadSchemas | null, json: unknown): boolean {
  if (schemas == null || !isRecord(json) || typeof json.more !== "boolean") return false;
  const { counted, kept } = json;
  return [counted, kept].every((rows) => Array.isArray(rows) && schemas.cashLinesSchema.safeParse({ rows, has_more: false }).success);
}

function projectLinesFit(data: unknown): boolean {
  return isRecord(data) && Array.isArray(data.counted) && Array.isArray(data.kept) && data.counted.length + data.kept.length <= KEPT_PROJECT_LINES;
}

/** list_utility_payers as the page holds it: the schema turns the answer into its `utilities` list, so the kept rows are checked by shape. */
function payersValid(_schemas: ReadSchemas | null, json: unknown): boolean {
  return Array.isArray(json) && json.every((row) => isRecord(row) && typeof row.supplier_id === "string" && (row.payer === "tenant" || row.payer === "company") && typeof row.currency === "string" && typeof row.bill_count === "number" && (row.usual_minor === null || isMinorString(row.usual_minor)));
}

/** Home's lines of a side: the one page of 20 the first view draws (the infinite read's data, a page and its param). */
const onePage = (data: unknown): boolean => isRecord(data) && Array.isArray(data.pages) && data.pages.length === 1 && Array.isArray(data.pageParams);

export const KEPT_RULES: readonly KeptRule[] = [
  // Home and Projects. FLOW-1292: the rest of Home's first view (the attention counts, the change pills, the weekly card, the first lines).
  rule("dashboard", (k) => k[0] === "dashboard" && off(k, 1), bySchema((s) => s.dashboardSchema)),
  rule("cash months", (k) => k[0] === "dashboard" && k[1] === "cash-months" && off(k, 2), bySchema((s) => s.cashMonthsSchema)),
  rule("cash years", (k) => k[0] === "dashboard" && k[1] === "cash-years" && off(k, 2), bySchema((s) => s.cashYearsSchema)),
  rule("cash year months", (k) => k[0] === "dashboard" && k[1] === "cash-year-months" && off(k, 2), bySchema((s) => s.cashMonthsSchema)),
  rule("unpaid", (k) => k[0] === "unpaid" && off(k, 1), bySchema((s) => s.unpaidRowSchema.array())),
  rule("transfer match count", (k) => k[0] === "transfer-match-count" && off(k, 1), (_s, json) => typeof json === "number" && Number.isInteger(json) && json >= 0),
  rule("utility refund count", (k) => k[0] === "utility-refund-count" && off(k, 1), (_s, json) => isRecord(json) && typeof json.notRefunded === "number" && Number.isInteger(json.notRefunded) && json.notRefunded >= 0 && Array.isArray(json.totals) && json.totals.every((row) => isRecord(row) && typeof row.currency === "string" && isMinorString(row.minor))),
  rule("cash to day", (k) => k.length === 5 && k[0] === "dashboard" && k[1] === "cash-to-day" && off(k, 2), bySchema((s) => s.cashToDaySchema)),
  // The weekly card's key has no preview part: Home draws the card out of preview only, and the read is the user's own.
  // The key has no preview segment: a preview never reads it (Home passes no week while previewing, and the sheet reads
  // only the signed-in company's weeks), so every row here is a real answer.
  rule("weekly summary", (k) => k.length === 3 && k[0] === "dashboard" && k[1] === "weekly-summary" && typeof k[2] === "string", bySchema((s) => s.weeklySummarySchema)),
  rule("home cash lines", (k) => k.length === 8 && k[0] === "breakdown-lines" && k[1] === "cash" && off(k, 2) && (k[4] === "in" || k[4] === "out") && k[6] === null && k[7] === 20, (s, json) => s != null && onePage(json) && isRecord((json as { pages: unknown[] }).pages[0]) && s.cashLinesSchema.safeParse((json as { pages: unknown[] }).pages[0]).success, { keep: onePage }),
  rule("company currency", (k) => k[0] === "company-currency" && off(k, 1), (_s, json) => typeof json === "string" && /^[A-Z]{3}$/.test(json)),
  // The project page.
  rule("project", (k) => k[0] === "project" && off(k, 1) && typeof k[2] === "string", bySchema((s) => s.projectDetailSchema), { keep: (data) => data != null }),
  rule("project month lines", (k) => k.length === 6 && k[0] === "breakdown-lines" && k[1] === "project-cash-month" && off(k, 2) && typeof k[3] === "string", projectLinesValid, { keep: projectLinesFit }),
  rule("utility payers", (k) => k[0] === "utility-payers" && off(k, 1) && typeof k[2] === "string", payersValid),
  // The project page's forecast card (expected_months and the month's overrides are kept under the forecast, below).
  rule("project category months", (k) => k.length === 5 && k[0] === "project" && k[1] === "category-months" && off(k, 2) && typeof k[3] === "string", bySchema((s) => s.projectCategoryMonthsSchema)),
  rule("project forecast edits", (k) => k.length === 4 && k[0] === "project-forecast-edits" && off(k, 1) && typeof k[2] === "string" && k[2] !== "company" && typeof k[3] === "string", (_s, json) => isRows(json, "id") && (json as Array<Record<string, unknown>>).every((row) => typeof row.kind === "string" && typeof row.pace === "string")),
  rule("categories", (k) => k.length === 2 && k[0] === "categories" && off(k, 1), bySchema((s) => s.categoryRowSchema.array())),
  // Loans.
  rule("loan list", (k) => k[0] === "loans" && typeof k[1] === "string" && k[2] === "list", (_s, json) => isRecord(json) && isRows(json.rows, "id") && Array.isArray(json.loans)),
  rule("loan currency", (k) => k[0] === "loan-currency" && typeof k[1] === "string", (_s, json) => json === "ILS" || json === "USD"),
  // Recurring.
  rule("recurring schedule", (k) => k.length === 1 && k[0] === "recurring-schedule", (_s, json) => isRows(json, "party_id")),
  rule("recurring changes", (k) => k[0] === "recurring-changes" && off(k, 1), bySchema((s) => s.recurringChangesSchema)),
  // Profit: a month, a year, any dates.
  rule("profit months", (k) => k[0] === "profit-months" && off(k, 1), bySchema((s) => s.profitMonthsSchema)),
  rule("company profit", (k) => k[0] === "dashboard" && (k[1] === "company-profit" || k[1] === "company-profit-ytd") && off(k, 2), bySchema((s) => s.dashboardSchema)),
  // FLOW-1278: Profit's month by project waits for the overhead project (the company's row): kept, so the kept figures draw at once. Only a set project is kept (a null answer is never).
  rule("company overhead", (k) => k[0] === "company-overhead" && off(k, 1), (_s, json) => isRecord(json) && typeof json.id === "string" && typeof json.name === "string"),
  rule("profit breakdown", (k) => k[0] === "breakdown" && (k[1] === "company-profit" || k[1] === "company-year") && off(k, 2), bySchema((s) => s.breakdownSchema)),
  // Profit's next-month card (FLOW-1291). The year views' full answer (p_rest) is not kept: it is far bigger and the card does not read it.
  rule("company next month inputs", (k) => k.length === 5 && k[0] === "project-forecast-edits" && off(k, 1) && k[2] === "company" && typeof k[3] === "string" && k[4] === false, (_s, json) => isRecord(json) && typeof json.month === "string" && Array.isArray(json.projects) && Array.isArray(json.general) && Array.isArray(json.edits)),
  rule("company forecast loans", (k) => k.length === 3 && k[0] === "loans" && k[1] === "company-forecast" && off(k, 2), (_s, json) => Array.isArray(json) && json.every((loan) => isRecord(loan) && typeof loan.id === "string" && (loan.currency === "ILS" || loan.currency === "USD") && isMinorString(loan.balanceMinor) && Array.isArray(loan.rates))),
  // Review's first page, with the list's state beside it.
  rule("review", (k) => k.length === 2 && k[0] === "review" && off(k, 1), bySchema((s) => s.reviewRowSchema.array()), { keep: (data) => Array.isArray(data) && data.length <= KEPT_REVIEW_ROWS }),
  rule("review state", (k) => k[0] === "review-meta" && off(k, 1) && k[2] === "", (_s, json) => isRecord(json) && typeof json.total === "number" && typeof json.loaded === "number", {
    manual: true,
    pair: (k) => ["review", k[1]],
    restore: (data) => (isRecord(data) ? { ...data, failed: false, loading: false } : data),
    keep: (data) => isRecord(data) && typeof data.loaded === "number" && data.loaded <= KEPT_REVIEW_ROWS,
  }),
  // The forecast.
  rule("expected months", (k) => k[0] === "expected-months" && off(k, 1), bySchema((s) => s.expectedMonthsSchema)),
  rule("missing bills", (k) => k[0] === "missing-bills" && off(k, 1), bySchema((s) => s.missingBillsSchema)),
  rule("month forecast", (k) => k[0] === "month-forecast" && off(k, 1) && typeof k[2] === "string" && k[2] !== "overrides", (_s, json) => isRecord(json) && typeof json.month === "string" && typeof json.base === "string" && isRecord(json.build) && Array.isArray(json.overrides)),
  rule("forecast overrides", (k) => k[0] === "month-forecast" && off(k, 1) && k[2] === "overrides", (_s, json) => Array.isArray(json)),
];

export function keptRuleOf(key: readonly unknown[]): KeptRule | null {
  return KEPT_RULES.find((item) => item.match(key)) ?? null;
}
