import { getSupabase } from "./lib/supabase";
import { balanceDate, pnlRange, type ReportState } from "./reports";

/**
 * FLOW-162: the reports as a file. flow-mcp's `report` route builds it (the same builder as the MCP tool
 * export_report), from the screen's own choices; the phone's share sheet sends it, or it downloads where
 * there is none.
 */

export type ShareChoice = { pnl: boolean; balance: boolean; expand: boolean; format: "pdf" | "csv" };

/** The route's arguments: the screen's period, date and projects, and what the sheet picked. */
export function reportFileArgs(state: ReportState, today: string, choice: ShareChoice): Record<string, unknown> {
  const kind = choice.pnl && choice.balance ? "both" : choice.balance ? "balance" : "pnl";
  const args: Record<string, unknown> = { kind, format: choice.format };
  if (kind !== "balance") {
    const range = pnlRange(state.period, today);
    if (range.from != null && range.to != null) {
      args.from = range.from;
      args.to = range.to;
    }
    args.expand = choice.expand;
    if (state.scope.kind === "by_project") args.by_project = true;
  }
  // The balance sheet's date: the one on screen when the balance sheet is open; from the P&L, the server's
  // default, the period's last day, so both reports end on the same day.
  if (kind === "balance" || (kind === "both" && state.kind === "balance")) args.as_of = balanceDate(state.asOf, today);
  if (state.scope.kind === "project") args.project_id = state.scope.id;
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
  const csv = args.format === "csv";
  const result = await supabase.functions.invoke<Blob | string>("flow-mcp/report", { body: args });
  const data = result.data;
  const context = (result.error as { context?: unknown } | null)?.context;
  if (context instanceof Response && context.status === 429) throw new TooManyFiles("rate_limited");
  if (result.error != null || data == null) throw new Error("report");
  const response = (result as { response?: Response }).response;
  const name = fileNameOf(response?.headers.get("content-disposition") ?? null) ?? (csv ? "report.csv" : "report.pdf");
  // A CSV comes back as text, which drops the byte-order mark Excel needs for Hebrew: it goes back on.
  const body = typeof data === "string" ? new Blob([`\uFEFF${data.replace(/^\uFEFF/, "")}`]) : data;
  return new File([body], name, { type: csv ? "text/csv" : "application/pdf" });
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
