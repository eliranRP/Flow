import {
  categoryRowSchema,
  dashboardSchema,
  projectCategorySchema,
  projectDetailSchema,
  projectWaitingSchema,
  filedTodaySchema,
  reviewRowSchema,
  sumitStatusSchema,
  transactionDetailSchema,
  unpaidRowSchema,
  type CategoryRow,
  type Dashboard,
  type FiledTodayRow,
  type ProjectCategoryPage,
  type ProjectDetail,
  type ProjectWaitingRow,
  type ReviewRow,
  type SumitStatus,
  type TransactionDetail,
  type UnpaidRow,
} from "@flow/shared";
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { getSupabase } from "./lib/supabase";
import { thisMonth, type PeriodChoice } from "./period";
import { useHomePreview } from "./preview";
import {
  JEV_CONNECTOR_STALE_MS,
  beginJevScopeLookup,
  companyIdFromReviewPayload,
  completeJevScopeLookup,
  dropLegacyJevConnectorKey,
  fetchJevConnector,
  jevConnectorQueryKey,
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

function rpcArgs(period: PeriodChoice): { p_basis: "invoiced"; p_from?: string; p_to?: string } {
  return {
    p_basis: "invoiced",
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

/** Session and company share one deadline. A hang keeps whichever part already arrived. */
async function settleReviewJevScope(
  supabase: ScopeClient,
  listed: PromiseLike<{ data: unknown; error: unknown }>,
  lookup: JevScopeLookup,
  client: QueryClient,
): Promise<void> {
  const found: { userId: string | null; companyId: string | null } = { userId: null, companyId: null };
  await withJevDeadline(undefined, async () => {
    await Promise.all([
      readSessionUserId(supabase).then((id) => {
        found.userId = id;
      }),
      readCompanyId(supabase).then((id) => {
        found.companyId = id;
      }),
    ]);
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
  const resolvedCompany = payloadCompany ?? found.companyId;
  const scope = found.userId != null && resolvedCompany != null
    ? { userId: found.userId, companyId: resolvedCompany }
    : null;
  if (!completeJevScopeLookup(lookup, scope) || scope == null) return;
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
}

export function useReviewQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["review", preview],
    enabled: active && preview === "off",
    queryFn: async ({ client }): Promise<ReviewRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
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
      const { data, error } = await supabase.rpc("sumit_status");
      if (error) throw error;
      return sumitStatusSchema.parse(data);
    },
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
      const { data, error } = await supabase.rpc("get_project", { p_id: projectId });
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

export function useProjectWaitingQuery(projectId: string) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["project-waiting", preview, projectId],
    enabled: preview === "off" && projectId !== "",
    queryFn: async (): Promise<ProjectWaitingRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
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
      const { data, error } = await supabase.rpc("get_transaction", { p_id: transactionId });
      if (error) throw error;
      return transactionDetailSchema.parse(data);
    },
  });
}

export function useInvalidateBooks() {
  const client = useQueryClient();
  return async (keys: readonly string[] = ["dashboard", "review", "unpaid", "categories", "sumit", "project", "project-category", "project-waiting", "filed-today", "txn", "home"]) => {
    await Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
  };
}
