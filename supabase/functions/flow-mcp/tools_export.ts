// MCP tools: export_report (FLOW-162), the reports as a file to download or share: the P&L, the balance sheet
// or both, as a PDF in Hebrew (report_pdf.ts) or a CSV for Excel (report_csv.ts). It reads the same
// statements as get_pnl_statement and get_balance_sheet, so the file shows the screen's numbers. The app's
// share button asks the same builder through flow-mcp's `report` route. Any member reads it.
import { parseBalanceSheet, parseStatement, reportFileName, type ReportFile, type ReportPart } from "../_shared/report_model.ts";
import { DATE, fail, isCalendarDate, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID } from "./tools_args.ts";

export const EXPORT_ALLOWED: Record<string, Set<string>> = {
  export_report: new Set(["kind", "format", "from", "to", "as_of", "project_id", "by_project", "basis", "expand"]),
};

export type ReportRequest = {
  kind: "pnl" | "balance" | "both";
  format: "pdf" | "csv";
  from: string | null;
  to: string | null;
  asOf: string | null;
  projectId: string | null;
  byProject: boolean;
  basis: "cash" | "invoiced" | null;
  expand: boolean;
};

/** A built file: its name, its media type and its bytes. */
export type BuiltReport = { name: string; mimeType: string; bytes: Uint8Array };

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

/** The arguments, checked before any read; a refusal names the one that failed. */
export function reportRequest(args: Record<string, unknown>): ReportRequest | ToolResult {
  const { kind = "pnl", format = "pdf", from, to, as_of: asOf, project_id: project, by_project: byProject, basis, expand } = args;
  if (kind !== "pnl" && kind !== "balance" && kind !== "both") return fail("validation", "kind: pnl, balance or both");
  if (format !== "pdf" && format !== "csv") return fail("validation", "format: pdf or csv");
  const problem = pnlProblem(args);
  if (problem != null) return problem;
  if (!optionalDate(asOf)) return fail("validation", "as_of: a date, YYYY-MM-DD");
  if (expand !== undefined && typeof expand !== "boolean") return fail("validation", "expand: true or false");
  return {
    kind,
    format,
    from: typeof from === "string" ? from : null,
    to: typeof to === "string" ? to : null,
    asOf: asOf ?? null,
    projectId: typeof project === "string" ? project : null,
    byProject: byProject === true,
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

/** Reads the reports and renders the file. A refusal (not found, a failed read) comes back as a ToolResult. */
export async function buildReport(request: ReportRequest, rpc: ToolRpc, now: Date): Promise<BuiltReport | ToolResult> {
  const clock = israelParts(now);
  const today = `${clock.year}-${clock.month}-${clock.day}`;
  const parts: ReportPart[] = [];
  if (request.kind !== "balance") {
    const result = await rpc("get_pnl_statement", {
      p_from: request.from,
      p_to: request.to,
      p_project_id: request.projectId,
      p_by_project: request.byProject,
      p_basis: request.basis,
    });
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    // Null for another company's project or an unknown one.
    if (result.json == null) return fail("not_found", "not found");
    try {
      parts.push({ kind: "pnl", statement: parseStatement(result.json), byProject: request.byProject, expand: request.expand });
    } catch {
      return fail("refused", READ_REFUSED);
    }
  }
  if (request.kind !== "pnl") {
    // Both reports: the balance sheet is at the P&L's last day unless as_of says otherwise.
    const asOf = request.asOf ?? (request.kind === "both" ? request.to : null) ?? today;
    const result = await rpc("mcp_balance_sheet", { p_as_of: asOf, p_project_id: request.projectId });
    // Another company's project, or an unknown one, raises P0002, which PostgREST answers with 404.
    if (result.status === 404) return fail("not_found", "not found");
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    if (result.json == null) return fail("not_found", "not found");
    try {
      parts.push({ kind: "balance", sheet: parseBalanceSheet(result.json) });
    } catch {
      return fail("refused", READ_REFUSED);
    }
  }
  // The company's name for the header; get_dashboard names the company this read is on.
  const named = await rpc("get_dashboard", { p_from: today, p_to: today, p_basis: null });
  const company = named.status < 400 && isObject(named.json) && typeof named.json.name === "string" ? named.json.name : "Flow";
  const file: ReportFile = { company, createdAt: `${clock.day}/${clock.month}/${clock.year} ${clock.hour}:${clock.minute}`, parts };
  // The renderers (pdf-lib, fontkit and the fonts) load only for a report, not on every flow-mcp start.
  if (request.format === "csv") {
    const { renderReportCsv } = await import("../_shared/report_csv.ts");
    return { name: reportFileName(file, "csv"), mimeType: "text/csv", bytes: new TextEncoder().encode(renderReportCsv(file)) };
  }
  const { renderReportPdf } = await import("../_shared/report_pdf.ts");
  return { name: reportFileName(file, "pdf"), mimeType: "application/pdf", bytes: await renderReportPdf(file) };
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
  return {
    ...ok({ file_name: built.name, mime_type: built.mimeType, size_bytes: built.bytes.length }),
    files: [{ name: built.name, mimeType: built.mimeType, base64: base64(built.bytes) }],
  };
}
