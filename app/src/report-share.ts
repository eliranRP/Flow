import { getSupabase } from "./lib/supabase";
import { balanceDate, pnlRange, type ReportState } from "./reports";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * FLOW-162: the reports as a file. flow-mcp's `report` route builds it (the same builder as the MCP tool
 * export_report), from the screen's own choices; the phone's share sheet sends it, or it downloads where
 * there is none.
 */

/** FLOW-993: the file's columns, a project or a period each; `total` is one column. */
export type ShareColumns = "total" | "project" | "month" | "quarter" | "year";

/**
 * What the sheet picked. `projectIds` null is every project; a list is the projects picked (empty until the
 * person picks one).
 */
export type ShareChoice = { pnl: boolean; balance: boolean; expand: boolean; format: "pdf" | "xlsx"; columns: ShareColumns; projectIds: string[] | null };

/** The sheet's first choice: the report on screen, and the screen's projects as columns or as the filter. */
export function shareChoiceOf(kind: ReportState["kind"], scope: ReportState["scope"]["kind"], projectId: string | null): ShareChoice {
  return {
    pnl: kind === "pnl",
    balance: kind === "balance",
    expand: true,
    format: "pdf",
    columns: scope === "by_project" ? "project" : "total",
    projectIds: scope === "project" && projectId != null ? [projectId] : null,
  };
}

/** The most period columns the server makes (export_report's MAX_PERIODS), and the most a PDF shows side by side. */
export const MAX_PERIODS = 36;
export const PDF_COLUMNS = 13;

/**
 * The range a file by period covers: the P&L's period, or for the balance sheet alone, 1 January of its date
 * to its date. Null when the P&L's period is all time (a period column needs dates).
 */
export function periodRange(state: ReportState, today: string, choice: ShareChoice): { from: string; to: string } | null {
  if (choice.pnl) {
    const range = pnlRange(state.period, today);
    return range.from == null || range.to == null ? null : { from: range.from, to: range.to };
  }
  const to = balanceDate(state.asOf, today);
  return { from: `${to.slice(0, 4)}-01-01`, to };
}

/** How many months, quarters or years the range spans, as the server counts its columns. */
export function periodCount(columns: "month" | "quarter" | "year", range: { from: string; to: string }): number {
  const [fy, fm] = [Number(range.from.slice(0, 4)), Number(range.from.slice(5, 7))];
  const [ty, tm] = [Number(range.to.slice(0, 4)), Number(range.to.slice(5, 7))];
  if (columns === "year") return ty - fy + 1;
  if (columns === "quarter") return ty * 4 + Math.floor((tm - 1) / 3) - (fy * 4 + Math.floor((fm - 1) / 3)) + 1;
  return ty * 12 + tm - (fy * 12 + fm) + 1;
}

/** The route's arguments: the screen's period and date, and the sheet's reports, columns and projects. */
export function reportFileArgs(state: ReportState, today: string, choice: ShareChoice): Record<string, unknown> {
  const kind = choice.pnl && choice.balance ? "both" : choice.balance ? "balance" : "pnl";
  const args: Record<string, unknown> = { kind, format: choice.format };
  if (choice.columns !== "total") args.columns = choice.columns;
  if (choice.projectIds != null && choice.projectIds.length > 0) args.project_ids = choice.projectIds;
  if (choice.columns !== "total" && choice.columns !== "project") {
    // By period: the range's months, quarters or years; the balance sheet is read at each one's end.
    const range = periodRange(state, today, choice);
    if (range != null) {
      args.from = range.from;
      args.to = range.to;
    }
    if (kind !== "balance") args.expand = choice.expand;
    return args;
  }
  if (kind !== "balance") {
    const range = pnlRange(state.period, today);
    if (range.from != null && range.to != null) {
      args.from = range.from;
      args.to = range.to;
    }
    args.expand = choice.expand;
  }
  // The balance sheet's date: the one on screen when the balance sheet is open; from the P&L, the server's
  // default, the period's last day, so both reports end on the same day.
  if (kind === "balance" || (kind === "both" && state.kind === "balance")) args.as_of = balanceDate(state.asOf, today);
  return args;
}

/** The file's name from the route's content-disposition (its UTF-8 form), or null. */
export function fileNameOf(disposition: string | null): string | null {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "");
  if (match?.[1] == null) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** The server's per-user file limit was reached (FLOW-166, 10 files a minute). */
export class TooManyFiles extends Error {}

export async function fetchReportFile(args: Record<string, unknown>): Promise<File> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const xlsx = args.format === "xlsx";
  const result = await supabase.functions.invoke<Blob | string>("flow-mcp/report", { body: args });
  const data = result.data;
  const context = (result.error as { context?: unknown } | null)?.context;
  if (context instanceof Response && context.status === 429) throw new TooManyFiles("rate_limited");
  if (result.error != null || data == null) throw new Error("report");
  const response = (result as { response?: Response }).response;
  const name = fileNameOf(response?.headers.get("content-disposition") ?? null) ?? (xlsx ? "report.xlsx" : "report.pdf");
  // A file always comes back as a Blob; text here means the route did not send one.
  if (typeof data === "string") throw new Error("report");
  return new File([data], name, { type: xlsx ? XLSX : "application/pdf" });
}

/**
 * Shares the file through the phone's share sheet, or downloads it. "cancelled": the share sheet was closed.
 * "blocked": the browser wants a fresh tap (the file took too long to make), so the caller keeps the file
 * and shares it on the next tap.
 */
export async function deliverFile(file: File, title: string, options: { download?: boolean } = {}): Promise<"shared" | "saved" | "cancelled" | "blocked"> {
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Refused again on a kept file (`download`): it downloads, so the button never loops.
      if (error instanceof DOMException && error.name === "NotAllowedError" && options.download !== true) return "blocked";
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) throw error;
    }
  }
  const href = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = href;
  link.download = file.name;
  link.click();
  // Some browsers read the URL after the click returns: it is freed a minute later.
  setTimeout(() => { URL.revokeObjectURL(href); }, 60_000);
  return "saved";
}
