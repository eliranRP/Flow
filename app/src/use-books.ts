import {
  categoryRowSchema,
  dashboardSchema,
  projectDetailSchema,
  reviewRowSchema,
  sumitStatusSchema,
  transactionDetailSchema,
  unpaidRowSchema,
  type CategoryRow,
  type Dashboard,
  type ProjectDetail,
  type ReviewRow,
  type SumitStatus,
  type TransactionDetail,
  type UnpaidRow,
} from "@flow/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { getSupabase } from "./lib/supabase";
import { thisMonth, type PeriodChoice } from "./period";
import { useHomePreview } from "./preview";

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

function rpcArgs(period: PeriodChoice): { p_basis: "invoiced"; p_from?: string; p_to?: string } {
  return {
    p_basis: "invoiced",
    ...(period.from && period.to ? { p_from: period.from, p_to: period.to } : {}),
  };
}

export function useDashboardQuery() {
  const preview = useHomePreview();
  const { period } = useBooks();
  return useQuery({
    queryKey: ["dashboard", preview, period],
    enabled: preview === "off",
    queryFn: async (): Promise<Dashboard> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data, error } = await supabase.rpc("get_dashboard", rpcArgs(period));
      if (error) throw error;
      return dashboardSchema.parse(data);
    },
  });
}

export function useUnpaidQuery() {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["unpaid", preview],
    enabled: preview === "off",
    queryFn: async (): Promise<UnpaidRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data, error } = await supabase.rpc("list_unpaid");
      if (error) throw error;
      return unpaidRowSchema.array().parse(data);
    },
  });
}

export function useReviewQuery() {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["review", preview],
    enabled: preview === "off",
    queryFn: async (): Promise<ReviewRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data, error } = await supabase.rpc("list_review");
      if (error) throw error;
      return reviewRowSchema.array().parse(data);
    },
  });
}

export function useCategoriesQuery() {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["categories", preview],
    enabled: preview === "off",
    queryFn: async (): Promise<CategoryRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data, error } = await supabase.rpc("list_categories");
      if (error) throw error;
      return categoryRowSchema.array().parse(data);
    },
  });
}

export function useSumitStatusQuery() {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["sumit", preview],
    enabled: preview === "off",
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
  return async (keys: readonly string[] = ["dashboard", "review", "unpaid", "categories", "sumit", "project", "txn", "home"]) => {
    await Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
  };
}
