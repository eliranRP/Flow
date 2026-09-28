import {
  categoryRowSchema,
  dashboardSchema,
  reviewRowSchema,
  sumitStatusSchema,
  unpaidRowSchema,
  type Basis,
  type CategoryRow,
  type Dashboard,
  type ReviewRow,
  type SumitStatus,
  type UnpaidRow,
} from "@flow/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from "react";
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
  const [period, setPeriod] = useState<PeriodChoice>(thisMonth());
  const [overheadOn, setOverheadOn] = useState(false);
  const value = useMemo(
    () => ({ period, setPeriod, overheadOn, setOverheadOn }),
    [period, overheadOn],
  );
  return createElement(BooksContext.Provider, { value }, children);
}

export function useBooks(): BooksContextValue {
  const value = useContext(BooksContext);
  if (!value) throw new Error("BooksProvider is missing");
  return value;
}

function rpcArgs(period: PeriodChoice): { p_basis: Basis; p_from?: string; p_to?: string } {
  return {
    p_basis: period.basis,
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

export function useInvalidateBooks() {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries();
  };
}
