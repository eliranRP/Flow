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
import { allTime, thisMonth, type PeriodChoice } from "./period";
import { useHomePreview } from "./preview";

interface BooksContextValue {
  period: PeriodChoice;
  setPeriod: (period: PeriodChoice) => void;
  overheadOn: boolean;
  setOverheadOn: (on: boolean) => void;
}

const BooksContext = createContext<BooksContextValue | null>(null);

export function BooksProvider({ children }: { children: ReactNode }) {
  const preview = useHomePreview();
  const [period, setPeriod] = useState<PeriodChoice>(preview === "demo" ? allTime() : thisMonth());
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
    enabled: preview === "off" || preview === "demo",
    placeholderData: () => {
      try {
        const raw = localStorage.getItem("flow-dashboard");
        if (!raw) return undefined;
        const stored: unknown = JSON.parse(raw);
        const payload = stored && typeof stored === "object" && "payload" in stored ? stored.payload : undefined;
        const parsed = dashboardSchema.safeParse(payload);
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    queryFn: async (): Promise<Dashboard> => {
      if (preview === "demo") {
        const model = await import("./demo/model");
        return model.demoDashboard(period.from, period.to, period.basis);
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data, error } = await supabase.rpc("get_dashboard", rpcArgs(period));
      if (error) throw error;
      const parsed = dashboardSchema.parse(data);
      try {
        localStorage.setItem("flow-dashboard", JSON.stringify({ at: new Date().toISOString(), payload: parsed }));
      } catch {
        // A full cache is not a reason to hide the books.
      }
      return parsed;
    },
  });
}

export function useUnpaidQuery() {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["unpaid", preview],
    enabled: preview === "off" || preview === "demo",
    queryFn: async (): Promise<UnpaidRow[]> => {
      if (preview === "demo") {
        const model = await import("./demo/model");
        return model.demoUnpaid();
      }
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
    enabled: preview === "off" || preview === "demo",
    queryFn: async (): Promise<ReviewRow[]> => {
      if (preview === "demo") {
        const model = await import("./demo/model");
        return model.demoReview();
      }
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
    enabled: preview === "off" || preview === "demo",
    queryFn: async (): Promise<CategoryRow[]> => {
      if (preview === "demo") {
        const model = await import("./demo/model");
        return model.demoCategories();
      }
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
    enabled: preview === "off" || preview === "demo",
    queryFn: async (): Promise<SumitStatus> => {
      if (preview === "demo") {
        return { connected: true, sumit_company_id: 2389917160, last_sync_at: null, last_error: null };
      }
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
