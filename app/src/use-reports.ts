import type { ProfitMonths } from "@flow/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import { balanceDate, pnlRange, type BalanceSheet, type ReportState, type Statement } from "./reports";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-161, FLOW-1045: the reports' reads. Query keys start with "dashboard" so the basis sheet's write (and
 * every write that refreshes the P&L) refreshes the statement too, "profit-months" for the months (the same
 * key as the company's other month reads) and "balance-sheet" for the balance sheet.
 */

async function readyClient() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  await waitForAccessToken(supabase);
  return supabase;
}

/** A period's dates; null ends mean every date. */
export type Range = { from: string | null; to: string | null };

type StatementArgs = Range & { projectId: string | null; byProject: boolean };

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

export type ReportRead<T> = { data: T | null | undefined; failed: boolean; readAt: number; refetch: () => void };

function readOf<T>(query: { data: T | null | undefined; isError: boolean; dataUpdatedAt: number; refetch: () => Promise<unknown> }): ReportRead<T> {
  return { data: query.data, failed: query.isError, readAt: query.dataUpdatedAt, refetch: () => { void query.refetch(); } };
}

/**
 * The P&L for a period: every project, one project (its id), or by project. `data` null: the project is not
 * found.
 */
export function usePnl(range: Range, projectId: string | null, byProject: boolean, enabled = true): ReportRead<Statement> {
  const preview = useHomePreview();
  const args: StatementArgs = { ...range, projectId, byProject };
  const query = useQuery({
    queryKey: ["dashboard", "pnl-statement", preview, args.from ?? "", args.to ?? "", args.projectId ?? "", args.byProject],
    enabled: enabled && preview === "off",
    queryFn: () => fetchStatement(args),
  });
  return readOf(query);
}

/** The company's profit by month over a period (get_profit_months, every project). */
export function useCompanyMonths(range: Range, enabled = true): ReportRead<NonNullable<ProfitMonths>> {
  const preview = useHomePreview();
  const query = useQuery({
    queryKey: ["profit-months", preview, "company", range.from ?? "", range.to ?? ""],
    enabled: enabled && preview === "off",
    queryFn: async (): Promise<NonNullable<ProfitMonths> | null> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("get_profit_months", range.from != null && range.to != null ? { p_from: range.from, p_to: range.to } : {});
      if (error) throw error;
      return (await loadReadSchemas()).profitMonthsSchema.parse(data);
    },
  });
  return readOf(query);
}

/** The balance sheet on a date, of everything or of one project. */
export function useBalanceAt(asOf: string, projectId: string | null, enabled = true): ReportRead<BalanceSheet> {
  const preview = useHomePreview();
  const query = useQuery({
    queryKey: ["balance-sheet", preview, asOf, projectId ?? ""],
    enabled: enabled && preview === "off",
    queryFn: () => fetchBalanceSheet(asOf, projectId),
  });
  return readOf(query);
}

/**
 * The balance sheet by project (BUILD-PLAN §5): one mcp_balance_sheet per project, composed the way the loans
 * summary reads each loan's payments. `data` is undefined until every sheet is in.
 */
export function useProjectBalances(asOf: string, projectIds: readonly string[], enabled = true): ReportRead<BalanceSheet[]> {
  const preview = useHomePreview();
  const queries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: ["balance-sheet", preview, asOf, projectId],
      enabled: enabled && preview === "off",
      queryFn: () => fetchBalanceSheet(asOf, projectId),
    })),
  });
  const done = queries.every((query) => query.data !== undefined);
  return {
    data: done ? queries.map((query) => query.data) : undefined,
    failed: queries.some((query) => query.isError),
    readAt: queries.length === 0 ? 0 : Math.min(...queries.map((query) => query.dataUpdatedAt)),
    refetch: () => {
      for (const query of queries) if (query.isError) void query.refetch();
    },
  };
}

/** Home's reports card (FLOW-161) reads the pre-v3 state. FLOW-1036 deletes that card; these two go with it. */
export function useStatement(state: ReportState, today: string, enabled = true): ReportRead<Statement> {
  return usePnl(pnlRange(state.period, today), state.scope.kind === "project" ? state.scope.id : null, state.scope.kind === "by_project", enabled);
}

export function useBalanceSheet(state: ReportState, today: string, enabled = true): ReportRead<BalanceSheet> {
  return useBalanceAt(balanceDate(state.asOf, today), state.scope.kind === "project" ? state.scope.id : null, enabled);
}
