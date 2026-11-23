import type { ReadSchemas } from "./load-read-schemas";

/**
 * FLOW-1267: which reads are kept on the device, named in one place. Only the first views of Home,
 * Projects, the project page, Loans, Recurring, Profit (month, year and any dates, with the overhead project), Review's first page
 * and the forecast. No search, no sheet's read, no write result. A key names its read by shape; a
 * preview's key (anything but "off") is never kept.
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

const off = (key: readonly unknown[], at: number): boolean => key[at] === "off";
const rule = (name: string, match: KeptRule["match"], valid: KeptRule["valid"], more: Partial<KeptRule> = {}): KeptRule => ({ name, match, valid, ...more });

/** Review's first page: the rows the queue had after its first read, and no more. */
export const KEPT_REVIEW_ROWS = 50;

export const KEPT_RULES: readonly KeptRule[] = [
  // Home and Projects.
  rule("dashboard", (k) => k[0] === "dashboard" && off(k, 1), bySchema((s) => s.dashboardSchema)),
  rule("cash months", (k) => k[0] === "dashboard" && k[1] === "cash-months" && off(k, 2), bySchema((s) => s.cashMonthsSchema)),
  rule("cash years", (k) => k[0] === "dashboard" && k[1] === "cash-years" && off(k, 2), bySchema((s) => s.cashYearsSchema)),
  rule("cash year months", (k) => k[0] === "dashboard" && k[1] === "cash-year-months" && off(k, 2), bySchema((s) => s.cashMonthsSchema)),
  rule("unpaid", (k) => k[0] === "unpaid" && off(k, 1), bySchema((s) => s.unpaidRowSchema.array())),
  rule("company currency", (k) => k[0] === "company-currency" && off(k, 1), (_s, json) => typeof json === "string" && /^[A-Z]{3}$/.test(json)),
  // The project page.
  rule("project", (k) => k[0] === "project" && off(k, 1) && typeof k[2] === "string", bySchema((s) => s.projectDetailSchema), { keep: (data) => data != null }),
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
  // Review's first page, with the list's state beside it.
  rule("review", (k) => k.length === 2 && k[0] === "review" && off(k, 1), bySchema((s) => s.reviewRowSchema.array()), { keep: (data) => Array.isArray(data) && data.length <= KEPT_REVIEW_ROWS }),
  rule("review state", (k) => k[0] === "review-meta" && off(k, 1) && k[2] === "", (_s, json) => isRecord(json) && typeof json.total === "number" && typeof json.loaded === "number", {
    manual: true,
    pair: (k) => (k[2] === "" ? ["review", k[1]] : ["review", k[1], "project", k[2]]),
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
