import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { getSupabase } from "../lib/supabase";
import { usePreviewMode } from "../preview";
import { isStandalone } from "../ui/install-prompt";
import { useDashboardQuery, useSumitStatusQuery } from "../use-books";
import { emptyFacts, type SetupFacts } from "./model";

async function jevRowExists(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function") return false;
  const { data, error } = await supabase.from("company_integrations").select("provider").eq("provider", "jev").maybeSingle();
  if (error) throw new Error(error.message);
  return data != null;
}

async function resolvedReviewExists(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function") return false;
  const { data, error } = await supabase
    .from("review_queue")
    .select("id")
    .in("status", ["approved", "skipped", "changed"])
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

/** Derived done-state. A failed read is not done. A disabled query does not block the runner. */
export function useSetupFacts(active = true): SetupFacts {
  const preview = usePreviewMode();
  const { status } = useAuth();
  const live = active && !preview && status === "authed";
  const dashboard = useDashboardQuery(live);
  const companyId = dashboard.data?.company_id ?? null;
  const hasCompany = typeof companyId === "string" && companyId !== "";
  const sumit = useSumitStatusQuery(live && hasCompany);
  const jev = useQuery({
    queryKey: ["setup-jev", companyId],
    enabled: live && hasCompany,
    queryFn: jevRowExists,
  });
  const review = useQuery({
    queryKey: ["setup-review-resolved", companyId],
    enabled: live && hasCompany,
    queryFn: resolvedReviewExists,
  });
  const standalone = isStandalone();
  if (!live || !dashboard.data) return { ...emptyFacts(!live), standalone };
  if (!hasCompany) return { ...emptyFacts(true), companyId: null, standalone };
  const waiting = sumit.isLoading || jev.isLoading || review.isLoading;
  return {
    ready: !waiting,
    companyId,
    sumitConnected: sumit.data?.connected === true,
    jevSaved: jev.data === true,
    hasResolvedReview: review.data === true,
    standalone,
  };
}
