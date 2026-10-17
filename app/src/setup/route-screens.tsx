import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { getSupabase } from "../lib/supabase";
import { usePreviewMode, usePreviewSearch } from "../preview";
import { useDashboardQuery } from "../use-books";
import { SKIP_ALL_COMPANY_NAME } from "./copy";
import { useSetupFacts } from "./facts";
import {
  indexTarget,
  nextPath,
  parseStep,
  previousPath,
  skipAllPatch,
  skipPatch,
  withPatch,
  type SetupFacts,
  type StepNumber,
} from "./model";
import { SetupWelcome } from "./welcome";
import { SetupDone, buildDoneRows } from "./done";
import { StepBusiness, StepConnect, StepInstall, StepJev, StepLoans, StepProjects, StepReview, type BusinessInitial, type StepProps } from "./steps";
import { readSetupStore, writeSetupStore, type SetupLender, type SetupStore } from "./storage";
import { useSetupStore } from "./store";
import { useSetupViewer } from "./viewer";

/** The company's base currency (companies.base_currency). Null while it loads or with no company. */
function useBaseCurrency(companyId: string | null): "USD" | "ILS" | null {
  const query = useQuery({
    queryKey: ["setup-base-currency", companyId],
    enabled: companyId != null,
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data, error } = await supabase.from("companies").select("base_currency").eq("id", companyId as string).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { base_currency?: string } | null)?.base_currency ?? "ILS";
    },
  });
  if (query.data === "USD") return "USD";
  if (query.data === "ILS") return "ILS";
  return null;
}

/** Writes a patch to the company's stored run. Reads first, so a stale render never drops a stamp. */
function commit(userId: string, companyId: string | null, patch: Partial<SetupStore>): void {
  const current = readSetupStore(userId, companyId);
  writeSetupStore(userId, companyId, withPatch(current, patch));
}

function useSetupRoute() {
  const preview = usePreviewMode();
  const search = usePreviewSearch();
  const viewer = useSetupViewer();
  const { status, session } = useAuth();
  const userId = session?.user.id ?? null;
  const facts = useSetupFacts(!preview && status === "authed" && !viewer.viewer);
  const { store, ready } = useSetupStore(userId, facts.companyId);
  const navigate = useNavigate();
  const client = useQueryClient();
  const dashboard = useDashboardQuery(!preview && status === "authed" && facts.companyId != null);
  const loading = status === "loading" || !viewer.ready || !facts.ready || !ready;
  return { preview, search, viewer, status, userId, facts, store, loading, navigate, client, dashboard };
}

/** The index (/setup) decides where the owner goes: the welcome, or the first step not done. */
export function SetupIndex() {
  const { preview, search, facts, store, loading, userId } = useSetupRoute();
  if (preview) return <Navigate to={`/${search}`} replace />;
  if (loading || userId == null) return null;
  return <Navigate to={indexTarget(store, facts)} replace />;
}

/** /setup/welcome: the first screen for a user with no company. A user who has one goes home. */
export function SetupWelcomeScreen() {
  const { preview, search, viewer, facts, loading, userId, navigate, client } = useSetupRoute();
  if (preview) return <Navigate to={`/${search}`} replace />;
  if (loading) return null;
  if (viewer.viewer) return <Navigate to={`/${search}`} replace />;
  if (facts.companyId != null) return <Navigate to="/" replace />;
  return (
    <SetupWelcome
      onStart={() => { void navigate("/setup/1"); }}
      onSkipAll={() => runSkipAll({ userId, facts, navigate, client })}
    />
  );
}

/** Skip all (the sheet, from any screen): a business "העסק שלי" when there is none, every step not done skipped, then Home. */
async function runSkipAll({
  userId,
  facts,
  navigate,
  client,
}: {
  userId: string | null;
  facts: SetupFacts;
  navigate: ReturnType<typeof useNavigate>;
  client: ReturnType<typeof useQueryClient>;
}): Promise<void> {
  if (userId == null) return;
  let companyId = facts.companyId;
  if (companyId == null) {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase.rpc("create_company", { p_name: SKIP_ALL_COMPANY_NAME, p_vat_registered: true });
    if (error || typeof data !== "string" || data === "") return;
    companyId = data;
    await client.refetchQueries({ queryKey: ["dashboard"], type: "all" });
  }
  const at = new Date().toISOString();
  const current = readSetupStore(userId, companyId);
  writeSetupStore(userId, companyId, skipAllPatch(current, { ...facts, companyId }, at));
  void navigate("/", { replace: true });
}

/** /setup/1 … /setup/7: one step. Each screen gets the route's writes, its navigation and its skip actions. */
export function SetupStepScreen() {
  const params = useParams();
  const step = parseStep(params.step);
  const route = useSetupRoute();
  const { preview, search, viewer, facts, store, loading, userId, navigate, client, dashboard } = route;
  if (preview) return <Navigate to={`/${search}`} replace />;
  if (step == null || step === "welcome" || step === "done") return <Navigate to="/setup" replace />;
  if (loading || userId == null) return null;
  if (viewer.viewer) return <Navigate to={`/${search}`} replace />;
  if (facts.companyId == null && step !== 1) return <Navigate to="/setup/welcome" replace />;
  return <StepBody key={step} step={step} userId={userId} facts={facts} store={store} navigate={navigate} client={client} dashboardName={dashboard.data?.name ?? null} dashboardBasis={dashboard.data?.basis ?? null} existingNames={(dashboard.data?.projects ?? []).map((project) => project.name)} />;
}

function StepBody({
  step,
  userId,
  facts,
  store,
  navigate,
  client,
  dashboardName,
  dashboardBasis,
  existingNames,
}: {
  step: StepNumber;
  userId: string;
  facts: SetupFacts;
  store: SetupStore;
  navigate: ReturnType<typeof useNavigate>;
  client: ReturnType<typeof useQueryClient>;
  dashboardName: string | null;
  dashboardBasis: "cash" | "invoiced" | null;
  existingNames: string[];
}) {
  const companyId = facts.companyId;
  const currency = useBaseCurrency(companyId);
  const back = previousPath(step);
  const toStep = nextPath(step);

  const props: StepProps = {
    onDone: (patch, id) => {
      commit(userId, id === undefined ? companyId : id, patch ?? {});
      void navigate(toStep);
    },
    onStamp: (patch) => { commit(userId, companyId, patch); },
    onBack: back == null ? undefined : () => { void navigate(back); },
    onSkipStep: () => {
      const current = readSetupStore(userId, companyId);
      writeSetupStore(userId, companyId, skipPatch(current, step, new Date().toISOString()));
      void navigate(toStep);
    },
    onSkipAll: () => runSkipAll({ userId, facts, navigate, client }),
  };

  if (step === 1) {
    const initial: BusinessInitial | null = companyId != null && currency != null && dashboardName != null
      ? { name: dashboardName, currency, basis: dashboardBasis === "cash" ? "paid" : "invoice" }
      : null;
    return <StepBusiness {...props} companyId={companyId} initial={initial} />;
  }
  if (step === 2) {
    return <StepConnect {...props} mercuryConnected={facts.mercuryConnected} sumitConnected={facts.sumitConnected} />;
  }
  if (step === 3) {
    return <StepProjects {...props} companyId={companyId} bankConnected={facts.mercuryConnected || facts.sumitConnected} existingNames={existingNames} />;
  }
  if (step === 4) {
    return (
      <StepLoans
        {...props}
        companyId={companyId}
        currency={currency ?? "ILS"}
        bankConnected={facts.mercuryConnected || facts.sumitConnected}
        picks={store.lenders}
        loanCount={facts.loanCount}
        onPick={(lender: SetupLender) => {
          if (store.lenders.some((item) => item.name === lender.name)) return;
          commit(userId, companyId, { lenders: [...store.lenders, lender] });
        }}
      />
    );
  }
  if (step === 5) return <StepJev {...props} />;
  if (step === 6) return <StepReview {...props} approved={store.sample_review_at != null} />;
  return <StepInstall {...props} />;
}

/** /setup/done: what was set up, and what waits in Settings. Reaching it stamps finished_at. */
export function SetupDoneScreen() {
  const { preview, search, viewer, facts, store, loading, userId, navigate, dashboard } = useSetupRoute();
  if (preview) return <Navigate to={`/${search}`} replace />;
  if (loading || userId == null) return null;
  if (viewer.viewer) return <Navigate to={`/${search}`} replace />;
  if (facts.companyId == null) return <Navigate to="/setup/welcome" replace />;
  const rows = buildDoneRows({
    store,
    facts,
    businessName: dashboard.data?.name ?? SKIP_ALL_COMPANY_NAME,
    pendingLenders: store.lenders.length,
  });
  return (
    <SetupDone
      rows={rows}
      onHome={() => {
        commit(userId, facts.companyId, { finished_at: new Date().toISOString() });
        void navigate("/");
      }}
    />
  );
}
