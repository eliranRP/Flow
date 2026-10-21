import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { getSupabase } from "../lib/supabase";
import { usePreviewMode } from "../preview";
import { isStandalone } from "../ui/install-prompt";
import { useDashboardQuery, useMercuryStatusQuery, useSumitStatusQuery } from "../use-books";
import { emptyFacts, type SetupFacts } from "./model";

type JevRow = { saved: boolean; on: boolean };

async function jevRow(): Promise<JevRow> {
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function") return { saved: false, on: false };
  const { data, error } = await supabase.from("company_integrations").select("enabled,mode").eq("provider", "jev").maybeSingle();
  if (error) throw new Error(error.message);
  if (data == null) return { saved: false, on: false };
  const row = data as { enabled?: unknown; mode?: unknown };
  return { saved: true, on: row.enabled === true && row.mode !== "off" };
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

async function loanCount(companyId: string): Promise<number> {
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function") return 0;
  const { data, error } = await supabase.from("loans").select("id").eq("company_id", companyId).limit(50);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.length : 0;
}

/**
 * Derived done-state. A failed read is not done. A disabled query does not block the runner.
 * `details` off reads the company alone (Home's own get_dashboard): the step facts stay empty
 * and ready, for a caller that only needs them while a run is open (SetupResume).
 */
export function useSetupFacts(active = true, details = true): SetupFacts {
  const preview = usePreviewMode();
  const { status } = useAuth();
  const live = active && !preview && status === "authed";
  const dashboard = useDashboardQuery(live);
  const companyId = dashboard.data?.company_id ?? null;
  const hasCompany = typeof companyId === "string" && companyId !== "";
  const steps = live && hasCompany && details;
  const sumit = useSumitStatusQuery(steps);
  const mercury = useMercuryStatusQuery(steps);
  const jev = useQuery({
    queryKey: ["setup-jev", companyId],
    enabled: steps,
    queryFn: jevRow,
  });
  const review = useQuery({
    queryKey: ["setup-review-resolved", companyId],
    enabled: steps,
    queryFn: resolvedReviewExists,
  });
  const loans = useQuery({
    queryKey: ["setup-loans", companyId],
    enabled: steps,
    queryFn: () => loanCount(companyId as string),
  });
  const standalone = isStandalone();
  if (!live || !dashboard.data) return { ...emptyFacts(!live), standalone };
  if (!hasCompany) return { ...emptyFacts(true), companyId: null, standalone };
  if (!details) return { ...emptyFacts(true), companyId, standalone, projectCount: dashboard.data.projects.length };
  const waiting = sumit.isLoading || mercury.isLoading || jev.isLoading || review.isLoading || loans.isLoading;
  return {
    ready: !waiting,
    companyId,
    sumitConnected: sumit.data?.connected === true,
    mercuryConnected: mercury.data?.connected === true,
    jevSaved: jev.data?.saved === true,
    jevOn: jev.data?.on === true,
    hasResolvedReview: review.data === true,
    standalone,
    projectCount: dashboard.data.projects.length,
    loanCount: loans.data ?? 0,
  };
}
