import {
  breakdownLinesSchema,
  breakdownSchema,
  categoryRowSchema,
  dashboardSchema,
  projectCategorySchema,
  projectDetailSchema,
  projectWaitingSchema,
  filedTodaySchema,
  reviewRowSchema,
  sumitStatusSchema,
  mercuryStatusSchema,
  transactionDetailSchema,
  unpaidRowSchema,
  type Breakdown,
  type BreakdownDirection,
  type BreakdownGroupBy,
  type BreakdownLinesPage,
  type CategoryRow,
  type Dashboard,
  type FiledTodayRow,
  type ProjectCategoryPage,
  type ProjectDetail,
  type ProjectWaitingRow,
  type ReviewRow,
  type SumitStatus,
  type MercuryStatus,
  type TransactionDetail,
  type UnpaidRow,
} from "@flow/shared";
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { getSupabase } from "./lib/supabase";
import { waitForAccessToken } from "./wait-for-session";
import { thisMonth, type PeriodChoice } from "./period";
import { useHomePreview } from "./preview";
import { parseTxnMetaList, type TxnMeta } from "./txn-meta";
import {
  JEV_CONNECTOR_STALE_MS,
  beginJevScopeLookup,
  companyIdFromReviewPayload,
  completeJevScopeLookup,
  dropLegacyJevConnectorKey,
  fetchJevConnector,
  jevConnectorQueryKey,
  jevScopeFollowsLive,
  jevQueueKey,
  jevQueueQueryKey,
  loadJevSuggestions,
  withJevDeadline,
  type JevScopeLookup,
} from "./screens/jev-review";

interface BooksContextValue {
  period: PeriodChoice;
  setPeriod: (period: PeriodChoice) => void;
  overheadOn: boolean;
  setOverheadOn: (on: boolean) => void;
}

const BooksContext = createContext<BooksContextValue | null>(null);

export function BooksProvider({ children }: { children: ReactNode }) {
  const [period, setPeriodState] = useState<PeriodChoice>(() => thisMonth());
  const setPeriod = useCallback((next: PeriodChoice) => {
    setPeriodState(next);
  }, []);
  const [overheadOn, setOverheadOn] = useState(false);
  const value = useMemo(
    () => ({ period, setPeriod, overheadOn, setOverheadOn }),
    [period, overheadOn, setPeriod],
  );
  return createElement(BooksContext.Provider, { value }, children);
}

export function useBooks(): BooksContextValue {
  const value = useContext(BooksContext);
  if (!value) throw new Error("BooksProvider is missing");
  return value;
}

/** Review queue tests render without a provider. A missing one is no company scope. */
export function useOptionalBooks(): BooksContextValue | null {
  return useContext(BooksContext);
}

/** The one books basis (decision 0060). Home and the project screen both read it, so project income counts the same doc kinds as Home. */
const BOOKS_BASIS = "invoiced";

function rpcArgs(period: PeriodChoice): { p_basis: typeof BOOKS_BASIS; p_from?: string; p_to?: string } {
  return {
    p_basis: BOOKS_BASIS,
    ...(period.from && period.to ? { p_from: period.from, p_to: period.to } : {}),
  };
}

export function useDashboardQuery(active = true) {
  const preview = useHomePreview();
  const { period } = useBooks();
  return useQuery({
    queryKey: ["dashboard", preview, period],
    enabled: active && preview === "off",
    queryFn: async (): Promise<Dashboard> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_dashboard", rpcArgs(period));
      if (error) throw error;
      return dashboardSchema.parse(data);
    },
  });
}

export function useUnpaidQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["unpaid", preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<UnpaidRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("list_unpaid");
      if (error) throw error;
      return unpaidRowSchema.array().parse(data);
    },
  });
}

export function useFiledTodayQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["filed-today", preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<FiledTodayRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("list_auto_assigned_today");
      if (error) throw error;
      return filedTodaySchema.array().parse(data);
    },
  });
}

function companyIdFromRow(company: { data: { id?: unknown } | null; error: unknown }): string | null {
  if (company.error != null || company.data == null || typeof company.data.id !== "string" || company.data.id === "") return null;
  return company.data.id;
}

type ScopeClient = NonNullable<ReturnType<typeof getSupabase>>;

function readSessionUserId(supabase: ScopeClient): PromiseLike<string | null> {
  if (typeof supabase.auth.getSession !== "function") return Promise.resolve(null);
  return supabase.auth.getSession().then(
    ({ data }) => {
      const id = data.session?.user.id;
      return id != null && id !== "" ? id : null;
    },
    () => null,
  );
}

function readCompanyId(supabase: ScopeClient): PromiseLike<string | null> {
  if (typeof supabase.from !== "function") return Promise.resolve(null);
  return supabase.from("companies").select("id").limit(1).maybeSingle().then(companyIdFromRow, () => null);
}

/** Session and company share one deadline. A row that arrives later may still bind. */
async function settleReviewJevScope(
  supabase: ScopeClient,
  listed: PromiseLike<{ data: unknown; error: unknown }>,
  lookup: JevScopeLookup,
  client: QueryClient,
): Promise<void> {
  const found: { userId: string | null; companyId: string | null } = { userId: null, companyId: null };
  const userTask = Promise.resolve(readSessionUserId(supabase)).then((id) => {
    found.userId = id;
  });
  const companyTask = Promise.resolve(readCompanyId(supabase)).then((id) => {
    found.companyId = id;
  });
  await withJevDeadline(undefined, async () => {
    await Promise.all([userTask, companyTask]);
    return true;
  }, false);
  let payloadCompany: string | null = null;
  let ids: string[] = [];
  try {
    const result = await listed;
    if (result.error == null) {
      payloadCompany = companyIdFromReviewPayload(result.data);
      ids = reviewRowSchema.array().parse(result.data).map((row) => row.transaction_id);
    }
  } catch {
    payloadCompany = null;
  }
  const publish = () => {
    const resolvedCompany = payloadCompany ?? found.companyId;
    const scope = found.userId != null && resolvedCompany != null
      ? { userId: found.userId, companyId: resolvedCompany }
      : null;
    if (!completeJevScopeLookup(lookup, scope) || scope == null || jevScopeFollowsLive()) return;
    if (jevQueueKey(ids) === "" || typeof supabase.from !== "function") return;
    void client.query({
      queryKey: jevConnectorQueryKey(scope),
      retry: false,
      staleTime: JEV_CONNECTOR_STALE_MS,
      queryFn: ({ signal }) => fetchJevConnector(signal),
    }).then((on) => {
      if (!on) return undefined;
      return client.query({
        queryKey: jevQueueQueryKey(ids),
        retry: false,
        queryFn: ({ signal }) => withJevDeadline(
          signal,
          (linked) => loadJevSuggestions(ids, linked),
          { connectorOn: false, byId: {} },
        ),
      });
    }).catch(() => undefined);
  };
  publish();
  void Promise.all([userTask, companyTask]).then(publish);
}

export function useReviewQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["review", preview],
    enabled: active && preview === "off",
    queryFn: async ({ client }): Promise<ReviewRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      dropLegacyJevConnectorKey();
      const listed = supabase.rpc("list_review");
      if (typeof supabase.from === "function") {
        const lookup = beginJevScopeLookup();
        void settleReviewJevScope(supabase, listed, lookup, client);
      }
      const { data, error } = await listed;
      if (error) throw error;
      return reviewRowSchema.array().parse(data);
    },
  });
}

export function useCategoriesQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["categories", preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<CategoryRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("list_categories");
      if (error) throw error;
      return categoryRowSchema.array().parse(data);
    },
  });
}

export function useSumitStatusQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["sumit", preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<SumitStatus> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("sumit_status");
      if (error) throw error;
      return sumitStatusSchema.parse(data);
    },
    // syncing is the server claim of a running refresh. Poll until it clears.
    refetchInterval: (q) => (q.state.data?.syncing === true ? 3000 : false),
    // Another tab may have started a run: re-read the claim when this tab is shown again.
    refetchOnWindowFocus: true,
  });
}

const mercuryDisconnected: MercuryStatus = {
  company_id: null,
  provider: "mercury",
  connected: false,
  last_sync_at: null,
  last_error: null,
  next_attempt_at: null,
  import_from: null,
  account_labels: null,
  skip_count: null,
};

export function useMercuryStatusQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["mercury", preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<MercuryStatus> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase
        .from("connector_connection_status")
        .select("company_id, provider, connected, last_sync_at, last_error, next_attempt_at, import_from, account_labels, skip_count, syncing")
        .eq("provider", "mercury")
        .maybeSingle();
      if (error) throw error;
      if (data == null) return mercuryDisconnected;
      const parsed = mercuryStatusSchema.parse({
        ...data,
        connected: data.connected === true,
        syncing: data.syncing === true,
      });
      return parsed;
    },
    // syncing is the server claim of a running refresh. Poll until it clears.
    refetchInterval: (q) => (q.state.data?.syncing === true ? 3000 : false),
    // Another tab may have started a run: re-read the claim when this tab is shown again.
    refetchOnWindowFocus: true,
  });
}

export function useProjectQuery(projectId: string) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["project", preview, projectId],
    enabled: preview === "off" && projectId !== "",
    queryFn: async (): Promise<ProjectDetail> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_project", { p_id: projectId, p_basis: BOOKS_BASIS });
      if (error) throw error;
      return projectDetailSchema.parse(data);
    },
  });
}

const CATEGORY_PAGE = 40;

export function useProjectCategoryQuery(projectId: string, categoryId: string) {
  const preview = useHomePreview();
  return useInfiniteQuery({
    queryKey: ["project-category", preview, projectId, categoryId],
    enabled: preview === "off" && projectId !== "" && categoryId !== "",
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ProjectCategoryPage> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("list_project_category", {
        p_project: projectId,
        p_category: categoryId,
        p_offset: pageParam,
        p_limit: CATEGORY_PAGE,
      });
      if (error) throw error;
      return projectCategorySchema.parse(data);
    },
    getNextPageParam: (page) => page?.next_offset ?? undefined,
  });
}

/** FLOW-301. Home's income or expenses by group, for Home's period and basis. */
export function useBreakdownQuery(direction: BreakdownDirection, groupBy: BreakdownGroupBy, active = true) {
  const preview = useHomePreview();
  const { period } = useBooks();
  return useQuery({
    queryKey: ["breakdown", preview, period, direction, groupBy],
    enabled: active && preview === "off",
    // A regroup or a new period keeps the screen and its controls; rows follow the data's own group_by.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Breakdown> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_breakdown", {
        ...rpcArgs(period),
        p_direction: direction,
        p_group_by: groupBy,
      });
      if (error) throw error;
      return breakdownSchema.parse(data);
    },
  });
}

const BREAKDOWN_PAGE = 40;

/** One group's lines, or the kept-out lines when excluded. */
export function useBreakdownLinesQuery(
  direction: BreakdownDirection,
  groupBy: BreakdownGroupBy,
  key: string,
  currency: string,
  excluded: boolean,
  active = true,
) {
  const preview = useHomePreview();
  const { period } = useBooks();
  return useInfiniteQuery({
    queryKey: ["breakdown-lines", preview, period, direction, groupBy, key, currency, excluded],
    enabled: active && preview === "off" && (excluded || key !== ""),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<BreakdownLinesPage> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_breakdown_lines", {
        ...rpcArgs(period),
        p_direction: direction,
        p_group_by: groupBy,
        p_group_key: key,
        p_currency: currency,
        p_excluded: excluded,
        p_limit: BREAKDOWN_PAGE,
        p_offset: pageParam,
      });
      if (error) throw error;
      return breakdownLinesSchema.parse(data);
    },
    getNextPageParam: (page, pages) => (page?.has_more === true ? pages.length * BREAKDOWN_PAGE : undefined),
  });
}

export function useProjectWaitingQuery(projectId: string) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["project-waiting", preview, projectId],
    enabled: preview === "off" && projectId !== "",
    queryFn: async (): Promise<ProjectWaitingRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("project_waiting", { p_project: projectId });
      if (error) throw error;
      return projectWaitingSchema.parse(data);
    },
  });
}

export function useTransactionQuery(transactionId: string) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["txn", preview, transactionId],
    enabled: preview === "off" && transactionId !== "",
    queryFn: async (): Promise<TransactionDetail> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_transaction", { p_id: transactionId });
      if (error) throw error;
      return transactionDetailSchema.parse(data);
    },
  });
}

export function lineMetaQueryKey(preview: string, transactionId: string) {
  return ["line-meta", preview, transactionId] as const;
}

/**
 * FLOW-304. Bank details for one line. Supplementary: a failed read leaves `data`
 * undefined and the card and detail render as before. No read in preview or sample.
 */
export function useLineMetaQuery(transactionId: string | null | undefined, enabled = true) {
  const preview = useHomePreview();
  const id = transactionId ?? "";
  return useQuery({
    queryKey: lineMetaQueryKey(preview, id),
    enabled: enabled && preview === "off" && id !== "",
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<TxnMeta | null> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_line_meta", { p_ids: [id] });
      if (error) throw error;
      return parseTxnMetaList(data).find((row) => row.transaction_id === id) ?? null;
    },
  });
}

export function useInvalidateBooks() {
  const client = useQueryClient();
  return async (keys: readonly string[] = ["dashboard", "review", "unpaid", "categories", "sumit", "project", "project-category", "project-waiting", "filed-today", "txn", "home", "breakdown", "breakdown-lines"]) => {
    await Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
  };
}
