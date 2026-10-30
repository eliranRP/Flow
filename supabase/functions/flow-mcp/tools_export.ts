// MCP tools: export_report (FLOW-162), the reports as a file to download or share: the P&L, the balance sheet
// or both, as a PDF in Hebrew (report_pdf.ts), an Excel workbook (report_xlsx.ts, FLOW-992) or a CSV
// (report_csv.ts). FLOW-991: a column per project or per period (columns), and one or more projects
// (project_ids); json returns the grid itself. It reads the same
// statements as get_pnl_statement and get_balance_sheet, so the file shows the screen's numbers. The app's
// share button asks the same builder through flow-mcp's `report` route. Any member reads it.
import { addSheets, balanceGridByPeriod, balanceGridByProject, mergeStatements, periods, pnlGrid } from "../_shared/report_grid.ts";
import {
  type BalanceSheet,
  displayDate,
  parseBalanceSheet,
  parseStatement,
  periodLabel,
  projectKeyName,
  reportFileName,
  type ReportFile,
  type ReportPart,
  type Statement,
  type StatementCurrency,
} from "../_shared/report_model.ts";
import { DATE, fail, isCalendarDate, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID } from "./tools_args.ts";

export const EXPORT_ALLOWED: Record<string, Set<string>> = {
  export_report: new Set(["kind", "format", "from", "to", "as_of", "project_id", "project_ids", "by_project", "columns", "basis", "expand"]),
};

export type ReportColumns = "total" | "project" | "month" | "quarter" | "year";

export type ReportRequest = {
  kind: "pnl" | "balance" | "both";
  format: "pdf" | "csv" | "xlsx" | "json";
  from: string | null;
  to: string | null;
  asOf: string | null;
  /** FLOW-991: the columns, projects or periods; the projects picked (empty: every project). */
  columns: ReportColumns;
  projectIds: string[];
  basis: "cash" | "invoiced" | null;
  expand: boolean;
};

/** A built file: its name, its media type and its bytes; `data` is the grid itself for format json. */
export type BuiltReport = { name: string; mimeType: string; bytes: Uint8Array; data?: unknown };

/** FLOW-991: at most this many periods, and this many reads for one file. */
export const MAX_PERIODS = 36;
const MAX_READS = 120;

function optionalDate(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === "string" && DATE.test(value) && isCalendarDate(value));
}

/**
 * The P&L's arguments (FLOW-160), shared by get_pnl_statement and export_report: both dates or neither, from
 * not after to, and one project or by_project, not both. Null when they are fine.
 */
export function pnlProblem(args: Record<string, unknown>): ToolResult | null {
  const { from, to, project_id: project, by_project: byProject, basis } = args;
  if (!optionalDate(from) || !optionalDate(to)) return fail("validation", "from and to: dates, YYYY-MM-DD");
  if ((from ?? null) === null !== ((to ?? null) === null)) return fail("validation", "from and to: both or neither");
  if (typeof from === "string" && typeof to === "string" && from > to) return fail("validation", "from is after to");
  if (project !== undefined && project !== null && (typeof project !== "string" || !UUID.test(project))) {
    return fail("validation", "project_id: a project id");
  }
  if (byProject !== undefined && typeof byProject !== "boolean") return fail("validation", "by_project: true or false");
  if (byProject === true && typeof project === "string") return fail("validation", "project_id or by_project, not both");
  if (basis !== undefined && basis !== null && basis !== "cash" && basis !== "invoiced") return fail("validation", "basis: cash or invoiced");
  return null;
}

const COLUMNS = new Set<unknown>(["total", "project", "month", "quarter", "year"]);

/** The arguments, checked before any read; a refusal names the one that failed. */
export function reportRequest(args: Record<string, unknown>): ReportRequest | ToolResult {
  const { kind = "pnl", format = "pdf", from, to, as_of: asOf, project_id: project, project_ids: projectIds, by_project: byProject, columns, basis, expand } = args;
  if (kind !== "pnl" && kind !== "balance" && kind !== "both") return fail("validation", "kind: pnl, balance or both");
  if (format !== "pdf" && format !== "csv" && format !== "xlsx" && format !== "json") return fail("validation", "format: pdf, xlsx, csv or json");
  const problem = pnlProblem(args);
  if (problem != null) return problem;
  if (!optionalDate(asOf)) return fail("validation", "as_of: a date, YYYY-MM-DD");
  if (expand !== undefined && typeof expand !== "boolean") return fail("validation", "expand: true or false");
  if (columns !== undefined && !COLUMNS.has(columns)) return fail("validation", "columns: total, project, month, quarter or year");
  // by_project is the older way to say columns project.
  if (byProject === true && columns !== undefined && columns !== "project") return fail("validation", "by_project or columns, not both");
  const by = (byProject === true ? "project" : columns ?? "total") as ReportColumns;
  let ids: string[] = [];
  if (projectIds !== undefined && projectIds !== null) {
    if (!Array.isArray(projectIds) || projectIds.length > 50 || projectIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
      return fail("validation", "project_ids: up to 50 project ids");
    }
    if (typeof project === "string") return fail("validation", "project_id or project_ids, not both");
    ids = [...new Set((projectIds as string[]).map((id) => id.toLowerCase()))];
  } else if (typeof project === "string") ids = [project.toLowerCase()];
  if (by !== "total" && by !== "project") {
    if (typeof from !== "string" || typeof to !== "string") return fail("validation", "columns by month, quarter or year need from and to");
    if (periods(by, from, to).length > MAX_PERIODS) return fail("validation", `at most ${String(MAX_PERIODS)} columns: pick a shorter range or longer periods`);
  }
  return {
    kind,
    format,
    from: typeof from === "string" ? from : null,
    to: typeof to === "string" ? to : null,
    asOf: asOf ?? null,
    columns: by,
    projectIds: ids,
    basis: basis === "cash" || basis === "invoiced" ? basis : null,
    expand: expand !== false,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function israelParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { day: part("day"), month: part("month"), year: part("year"), hour: part("hour"), minute: part("minute") };
}

type Project = { id: string; name: string };
/** A refusal while reading, carried up to the tool's answer. */
class Refusal extends Error {
  constructor(readonly result: ToolResult) {
    super("refused");
  }
}

/** Reads the reports and renders the file. A refusal (not found, a failed read) comes back as a ToolResult. */
export async function buildReport(request: ReportRequest, rpc: ToolRpc, now: Date): Promise<BuiltReport | ToolResult> {
  try {
    return await build(request, rpc, now);
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    throw error;
  }
}

async function build(request: ReportRequest, rpc: ToolRpc, now: Date): Promise<BuiltReport> {
  const clock = israelParts(now);
  const today = `${clock.year}-${clock.month}-${clock.day}`;
  // The company's name for the header and its projects; get_dashboard names the company this read is on.
  const named = await rpc("get_dashboard", { p_from: today, p_to: today, p_basis: null });
  // The project list is the guard for project_ids: when it cannot be read, nothing is read (fail closed).
  if (named.status >= 400) throw new Refusal(fail("refused", READ_REFUSED));
  const company = isObject(named.json) && typeof named.json.name === "string" ? named.json.name : "Flow";
  const allProjects: Project[] = isObject(named.json) && Array.isArray(named.json.projects)
    ? named.json.projects.filter(isObject).flatMap((row) => (typeof row.id === "string" && typeof row.name === "string" ? [{ id: row.id.toLowerCase(), name: row.name }] : []))
    : [];
  const picked: Project[] = request.projectIds.map((id) => allProjects.find((project) => project.id === id) ?? { id, name: "" });
  // Another company's project, or an unknown one, is not on the company's list.
  if (allProjects.length > 0 && picked.some((project) => project.name === "")) throw new Refusal(fail("not_found", "not found"));
  const reads = new Reads(rpc);
  const gridFormat = request.format === "xlsx" || request.format === "json";
  const parts: ReportPart[] = [];
  const asOf = request.asOf ?? (request.kind === "both" ? request.to : null) ?? today;
  if (request.kind !== "balance") parts.push(await pnlPart(request, reads, picked, gridFormat));
  if (request.kind !== "pnl") parts.push(await balancePart(request, reads, picked, allProjects, asOf, gridFormat));
  const file: ReportFile = { company, createdAt: `${clock.day}/${clock.month}/${clock.year} ${clock.hour}:${clock.minute}`, parts };
  if (request.format === "json") {
    const data = reportJson(file);
    return { name: reportFileName(file, "pdf").replace(/\.pdf$/, ".json"), mimeType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(data)), data };
  }
  // The renderers (pdf-lib, fontkit and the fonts) load only for a report, not on every flow-mcp start.
  if (request.format === "csv") {
    const { renderReportCsv } = await import("../_shared/report_csv.ts");
    return { name: reportFileName(file, "csv"), mimeType: "text/csv", bytes: new TextEncoder().encode(renderReportCsv(file)) };
  }
  if (request.format === "xlsx") {
    const { renderReportXlsx } = await import("../_shared/report_xlsx.ts");
    return { name: reportFileName(file, "xlsx"), mimeType: XLSX, bytes: await renderReportXlsx(file) };
  }
  const { renderReportPdf } = await import("../_shared/report_pdf.ts");
  return { name: reportFileName(file, "pdf"), mimeType: "application/pdf", bytes: await renderReportPdf(file) };
}

export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The reads one file makes, counted so a wide request stops before it loads the database. */
class Reads {
  private count = 0;
  constructor(private readonly rpc: ToolRpc) {}

  private async call(name: string, body: Record<string, unknown>) {
    if (++this.count > MAX_READS) throw new Refusal(fail("validation", "too many columns for one file: pick fewer projects or longer periods"));
    return await this.rpc(name, body);
  }

  async statement(request: ReportRequest, from: string | null, to: string | null, projectId: string | null, byProject: boolean): Promise<Statement> {
    const result = await this.call("get_pnl_statement", { p_from: from, p_to: to, p_project_id: projectId, p_by_project: byProject, p_basis: request.basis });
    if (result.status >= 400) throw new Refusal(fail("refused", READ_REFUSED));
    // Null for another company's project or an unknown one.
    if (result.json == null) throw new Refusal(fail("not_found", "not found"));
    try {
      return parseStatement(result.json);
    } catch {
      throw new Refusal(fail("refused", READ_REFUSED));
    }
  }

  async sheet(asOf: string, projectId: string | null): Promise<BalanceSheet> {
    const result = await this.call("mcp_balance_sheet", { p_as_of: asOf, p_project_id: projectId });
    // Another company's project, or an unknown one, raises P0002, which PostgREST answers with 404.
    if (result.status === 404 || (result.status < 400 && result.json == null)) throw new Refusal(fail("not_found", "not found"));
    if (result.status >= 400) throw new Refusal(fail("refused", READ_REFUSED));
    try {
      return parseBalanceSheet(result.json);
    } catch {
      throw new Refusal(fail("refused", READ_REFUSED));
    }
  }
}

function scopeText(picked: Project[]): string {
  if (picked.length === 0) return "כל הפרויקטים";
  return picked.length <= 3 ? picked.map((project) => project.name).join(", ") : `${String(picked.length)} פרויקטים`;
}

/** The currencies a set of columns has, in the order they first come. */
function currenciesOf(lists: { currency: string }[][]): string[] {
  return [...new Set(lists.flat().map((row) => row.currency))];
}

/** One period's (or the whole range's) statement rows for the picked projects: the company, one, or several added up. */
async function scopedRows(request: ReportRequest, reads: Reads, picked: Project[], from: string | null, to: string | null): Promise<{ rows: StatementCurrency[]; statement: Statement }> {
  if (picked.length <= 1) {
    const statement = await reads.statement(request, from, to, picked[0]?.id ?? null, false);
    return { rows: statement.currencies, statement };
  }
  const statement = await reads.statement(request, from, to, null, true);
  const chosen = statement.projects.filter((project) => project.project_id != null && picked.some((item) => item.id === project.project_id?.toLowerCase()));
  const lists = chosen.map((project) => project.currencies);
  return { rows: currenciesOf(lists).map((currency) => mergeStatements(currency, lists.map((list) => list.find((row) => row.currency === currency)))), statement };
}

async function pnlPart(request: ReportRequest, reads: Reads, picked: Project[], gridFormat: boolean): Promise<ReportPart> {
  // The period as the statement echoes it (the server's default range when none was asked).
  const whenOf = (statement: Pick<Statement, "from" | "to">) => ({
    when: periodLabel(statement),
    fileWhen: statement.from == null ? "מההתחלה" : `${statement.from}_${statement.to ?? ""}`,
  });
  const scope = scopeText(picked);
  if (request.columns === "total") {
    const { rows, statement } = await scopedRows(request, reads, picked, request.from, request.to);
    const merged: Statement = { ...statement, project_name: picked.length === 0 ? null : picked.length === 1 ? (statement.project_name ?? scope) : scope, currencies: rows, projects: [] };
    if (!gridFormat) return { kind: "pnl", statement: merged, expand: request.expand };
    const grids = rows.map((row) => pnlGrid("total", row.currency, [{ label: "סכום", rows: [row] }], request.expand, statement.review_count));
    return { kind: "grid", report: "pnl", by: "total", ...whenOf(statement), scope, basis: statement.basis, grids };
  }
  if (request.columns === "project") {
    const statement = await reads.statement(request, request.from, request.to, null, true);
    const named = statement.projects.filter((project) => project.project_id != null);
    const columns = picked.length === 0
      ? named.map((project) => ({ label: projectKeyName(project), lists: [project.currencies] }))
      : picked.map((item) => ({ label: item.name, lists: named.filter((project) => project.project_id?.toLowerCase() === item.id).map((project) => project.currencies) }));
    // Every project: "כללי" holds the overhead and the lines with no project, so the total is the company's.
    if (picked.length === 0) {
      const general = statement.projects.filter((project) => project.project_id == null).map((project) => project.currencies);
      if (general.some((list) => list.length > 0)) columns.push({ label: "כללי", lists: general });
    }
    const lists = columns.flatMap((column) => column.lists);
    const grids = currenciesOf(lists).map((currency) =>
      pnlGrid("project", currency, columns.map((column) => ({ label: column.label, rows: [mergeStatements(currency, column.lists.map((list) => list.find((row) => row.currency === currency)))] })), request.expand, statement.review_count)
    );
    return { kind: "grid", report: "pnl", by: "project", ...whenOf(statement), scope, basis: statement.basis, grids };
  }
  const spans = periods(request.columns, request.from ?? "", request.to ?? "");
  const spanReads: { rows: StatementCurrency[]; statement: Statement }[] = [];
  for (const span of spans) spanReads.push(await scopedRows(request, reads, picked, span.from, span.to));
  const review = spanReads.reduce((sum, read) => sum + read.statement.review_count, 0);
  const grids = currenciesOf(spanReads.map((read) => read.rows)).map((currency) =>
    pnlGrid(request.columns, currency, spans.map((span, index) => ({ label: span.label, rows: spanReads[index]?.rows ?? [] })), request.expand, review)
  );
  return { kind: "grid", report: "pnl", by: request.columns, ...whenOf(request), scope, basis: spanReads[0]?.statement.basis ?? null, grids };
}

/** The balance sheet on one date for the picked projects: the company, one, or several added up. */
async function scopedSheet(reads: Reads, picked: Project[], asOf: string): Promise<BalanceSheet> {
  if (picked.length <= 1) return await reads.sheet(asOf, picked[0]?.id ?? null);
  const sheets: BalanceSheet[] = [];
  for (const project of picked) sheets.push(await reads.sheet(asOf, project.id));
  const currencies = currenciesOf(sheets.map((sheet) => sheet.currencies));
  return { as_of: asOf, project_name: null, currencies: currencies.map((currency) => addSheets(currency, sheets.map((sheet) => sheet.currencies.find((row) => row.currency === currency)))) };
}

async function balancePart(request: ReportRequest, reads: Reads, picked: Project[], allProjects: Project[], asOf: string, gridFormat: boolean): Promise<ReportPart> {
  const scope = scopeText(picked);
  const date = displayDate(asOf);
  if (request.columns === "total") {
    const sheet = await scopedSheet(reads, picked, asOf);
    const named = { ...sheet, project_name: picked.length === 0 ? null : picked.length === 1 ? (sheet.project_name ?? scope) : scope };
    if (!gridFormat) return { kind: "balance", sheet: named };
    const grids = sheet.currencies.map((row) => balanceGridByPeriod("total", row.currency, [{ label: date, sheet: row }]));
    return { kind: "grid", report: "balance", by: "total", when: `נכון ל־${date}`, fileWhen: asOf, scope, basis: null, grids };
  }
  if (request.columns === "project") {
    const companySheet = picked.length === 0 ? await reads.sheet(asOf, null) : null;
    const projects = picked.length === 0 ? allProjects : picked;
    const sheets: { project: Project; sheet: BalanceSheet }[] = [];
    for (const project of projects) sheets.push({ project, sheet: await reads.sheet(asOf, project.id) });
    // Every project: a project with no balances has no column. Picked ones always have theirs.
    const shown = picked.length === 0 ? sheets.filter(({ sheet }) => sheet.currencies.some((row) => row.assets.accounts.length + row.liabilities.accounts.length + row.equity.accounts.length > 0)) : sheets;
    const currencies = currenciesOf([...(companySheet == null ? [] : [companySheet.currencies]), ...shown.map(({ sheet }) => sheet.currencies)]);
    const grids = currencies.map((currency) =>
      balanceGridByProject(
        currency,
        shown.map(({ project, sheet }) => ({ label: project.name, sheet: sheet.currencies.find((row) => row.currency === currency) })),
        companySheet?.currencies.find((row) => row.currency === currency),
        picked.length === 0,
        date,
      )
    );
    return { kind: "grid", report: "balance", by: "project", when: `נכון ל־${date}`, fileWhen: asOf, scope, basis: null, grids };
  }
  // By period: the balance at the end of each period of the P&L's range; the last column is its last day.
  const spans = periods(request.columns, request.from ?? "", request.to ?? "");
  const sheets: BalanceSheet[] = [];
  for (const span of spans) sheets.push(await scopedSheet(reads, picked, span.to));
  const grids = currenciesOf(sheets.map((sheet) => sheet.currencies)).map((currency) =>
    balanceGridByPeriod(request.columns, currency, spans.map((span, index) => ({ label: displayDate(span.to), sheet: sheets[index]?.currencies.find((row) => row.currency === currency) })))
  );
  const last = spans[spans.length - 1]?.to ?? asOf;
  return { kind: "grid", report: "balance", by: request.columns, when: `${displayDate(spans[0]?.to ?? last)}–${displayDate(last)}`, fileWhen: last, scope, basis: null, grids };
}

/** format json: the grids as plain data, amounts in minor units. */
function reportJson(file: ReportFile) {
  const amount = (value: bigint | null) => (value == null ? null : Number(value));
  return {
    company: file.company,
    created_at: file.createdAt,
    reports: file.parts.flatMap((part) =>
      part.kind !== "grid" ? [] : [{
        report: part.report,
        columns: part.by,
        period: part.when,
        projects: part.scope,
        basis: part.basis,
        grids: part.grids.map((grid) => ({
          currency: grid.currency,
          columns: grid.columns,
          has_total: grid.hasTotal,
          rows: grid.rows.filter((row) => row.kind !== "section").map((row) => ({ kind: row.kind, label: row.label, amounts_minor: row.cells.map(amount), total_minor: grid.hasTotal ? amount(row.total) : null })),
          notes: grid.notes,
        })),
      }]
    ),
  };
}

export function isBuilt(value: BuiltReport | ToolResult): value is BuiltReport {
  return "bytes" in value;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** export_report: the file rides as an embedded resource; the structured result names it. */
export async function exportReport(args: Record<string, unknown>, rpc: ToolRpc, now: Date = new Date()): Promise<ToolResult> {
  const request = reportRequest(args);
  if (!("kind" in request)) return request;
  const built = await buildReport(request, rpc, now);
  if (!isBuilt(built)) return built;
  // json: the grid in the answer itself, no file.
  if (request.format === "json") return ok(built.data);
  return {
    ...ok({ file_name: built.name, mime_type: built.mimeType, size_bytes: built.bytes.length }),
    files: [{ name: built.name, mimeType: built.mimeType, base64: base64(built.bytes) }],
  };
}
