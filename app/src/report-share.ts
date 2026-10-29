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
  if (kind !== "pnl") args.as_of = balanceDate(state.asOf, today);
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

export async function fetchReportFile(args: Record<string, unknown>): Promise<File> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const csv = args.format === "csv";
  const result = await supabase.functions.invoke<Blob | string>("flow-mcp/report", { body: args });
  const data = result.data;
  if (result.error != null || data == null) throw new Error("report");
  const response = (result as { response?: Response }).response;
  const name = fileNameOf(response?.headers.get("content-disposition") ?? null) ?? (csv ? "report.csv" : "report.pdf");
  // A CSV comes back as text, which drops the byte-order mark Excel needs for Hebrew: it goes back on.
  const body = typeof data === "string" ? new Blob([`\uFEFF${data.replace(/^\uFEFF/, "")}`]) : data;
  return new File([body], name, { type: csv ? "text/csv" : "application/pdf" });
}

/** Shares the file through the phone's share sheet, or downloads it. "cancelled": the share sheet was closed. */
export async function deliverFile(file: File, title: string): Promise<"shared" | "saved" | "cancelled"> {
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }
  const href = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = href;
  link.download = file.name;
  link.click();
  // The click starts the download before this runs.
  setTimeout(() => { URL.revokeObjectURL(href); }, 0);
  return "saved";
}
