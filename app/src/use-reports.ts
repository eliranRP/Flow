import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import { balanceDate, pnlRange, type BalanceSheet, type ReportState, type Statement } from "./reports";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-161: the reports' reads. Query keys start with "dashboard" so the basis sheet's write (and every
 * write that refreshes the P&L) refreshes the statement too, and "balance-sheet" for the balance sheet.
 */

async function readyClient() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  await waitForAccessToken(supabase);
  return supabase;
}

type StatementArgs = { from: string | null; to: string | null; projectId: string | null; byProject: boolean };

export async function fetchStatement(args: StatementArgs): Promise<Statement | null> {
  const supabase = await readyClient();
  const { data, error } = await supabase.rpc("get_pnl_statement", {
    ...(args.from != null && args.to != null ? { p_from: args.from, p_to: args.to } : {}),
    ...(args.projectId != null ? { p_project_id: args.projectId } : {}),
    p_by_project: args.byProject,
  });
  if (error) throw error;
  // Null: the project is not this company's (or is gone).
  if (data == null) return null;
  return (await loadReadSchemas()).pnlStatementSchema.parse(data);
}

export async function fetchBalanceSheet(asOf: string, projectId: string | null): Promise<BalanceSheet> {
  const supabase = await readyClient();
  const { data, error } = await supabase.rpc("mcp_balance_sheet", { p_as_of: asOf, ...(projectId != null ? { p_project_id: projectId } : {}) });
  if (error) throw error;
  return (await loadReadSchemas()).balanceSheetSchema.parse(data);
}

export type ReportRead<T> = { data: T | null | undefined; pending: boolean; failed: boolean; readAt: number; refetch: () => void };

/** The P&L for the screen's period and projects. `data` null: the project is not found. */
export function useStatement(state: ReportState, today: string, enabled = true): ReportRead<Statement> {
  const preview = useHomePreview();
  const range = pnlRange(state.period, today);
  const args: StatementArgs = {
    from: range.from,
    to: range.to,
    projectId: state.scope.kind === "project" ? state.scope.id : null,
    byProject: state.scope.kind === "by_project",
  };
  const query = useQuery({
    queryKey: ["dashboard", "pnl-statement", preview, args.from ?? "", args.to ?? "", args.projectId ?? "", args.byProject],
    enabled: enabled && preview === "off",
    queryFn: () => fetchStatement(args),
  });
  return { data: query.data, pending: query.isPending, failed: query.isError, readAt: query.dataUpdatedAt, refetch: () => { void query.refetch(); } };
}

/** The balance sheet for the screen's date and project. */
export function useBalanceSheet(state: ReportState, today: string, enabled = true): ReportRead<BalanceSheet> {
  const preview = useHomePreview();
  const asOf = balanceDate(state.asOf, today);
  const projectId = state.scope.kind === "project" ? state.scope.id : null;
  const query = useQuery({
    queryKey: ["balance-sheet", preview, asOf, projectId ?? ""],
    enabled: enabled && preview === "off",
    queryFn: () => fetchBalanceSheet(asOf, projectId),
  });
  return { data: query.data, pending: query.isPending, failed: query.isError, readAt: query.dataUpdatedAt, refetch: () => { void query.refetch(); } };
}

/**
 * The projects the picker lists, from the by-project statement: on the P&L every project with a line this
 * period; on the balance sheet every project with a line at any time (a balance has no period).
 */
export function useReportProjects(state: ReportState, today: string, enabled: boolean): ReportRead<Statement> {
  const period = state.kind === "balance" ? ({ kind: "all" } as const) : state.period;
  return useStatement({ ...state, period, scope: { kind: "by_project" } }, today, enabled);
}
