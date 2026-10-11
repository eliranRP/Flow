import { lazy, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { usePreviewMode, usePreviewSearch } from "../preview";
import { useGoBack } from "../ui/back";
import { useDashboardQuery } from "../use-books";
import { useSetupFacts } from "./facts";
import {
  backPath,
  continuePath,
  confirmLists,
  finishInstall,
  finishIos,
  indexTarget,
  parseStep,
  skipPatch,
  type SetupStepId,
} from "./model";
import { useSetupStore } from "./store";
import { companyCreatedThisRun, readSetupStore, writeSetupStore } from "./storage";
import { useSetupViewer } from "./viewer";
import { screenLoaders } from "../screen-loaders";

// FLOW-804: the steps load when a setup screen opens, so Home's first load skips them.
const loadSteps = screenLoaders.setupSteps;
const StepBusiness = lazy(() => loadSteps().then((m) => ({ default: m.StepBusiness })));
const StepStarter = lazy(() => loadSteps().then((m) => ({ default: m.StepStarter })));
const StepSumit = lazy(() => loadSteps().then((m) => ({ default: m.StepSumit })));
const StepJev = lazy(() => loadSteps().then((m) => ({ default: m.StepJev })));
const StepLists = lazy(() => loadSteps().then((m) => ({ default: m.StepLists })));
const StepReview = lazy(() => loadSteps().then((m) => ({ default: m.StepReview })));
const StepInstall = lazy(() => loadSteps().then((m) => ({ default: m.StepInstall })));

function useFromCard(): boolean {
  const [params] = useSearchParams();
  return params.get("from") === "card";
}

export function SetupIndex() {
  const preview = usePreviewMode();
  const search = usePreviewSearch();
  const { status, session } = useAuth();
  const facts = useSetupFacts(!preview && status === "authed");
  const { store, ready } = useSetupStore(session?.user.id ?? null, facts.companyId);
  if (preview) return <Navigate to={`/${search}`} replace />;
  // Wait for the server copy too (FLOW-506), so a new phone opens the step the owner reached.
  if (status === "loading" || !facts.ready || !ready) return null;
  return <Navigate to={indexTarget(store, facts)} replace />;
}

export function SetupStepScreen() {
  const preview = usePreviewMode();
  const search = usePreviewSearch();
  const params = useParams();
  const step = parseStep(params.step);
  const viewer = useSetupViewer();
  const { status, session } = useAuth();
  const userId = session?.user.id ?? null;
  const facts = useSetupFacts(!preview && status === "authed" && !viewer.viewer);
  const { store, ready } = useSetupStore(userId, facts.companyId);
  if (preview) return <Navigate to={`/${search}`} replace />;
  if (step == null) return <Navigate to="/setup" replace />;
  if (!viewer.ready || status === "loading") return null;
  if (viewer.viewer) return <Navigate to={`/${search}`} replace />;
  if (!facts.ready || !ready) return null;
  if (step === 0 && facts.companyId != null && !(userId && companyCreatedThisRun(userId))) {
    return <Navigate to={indexTarget(store, facts)} replace />;
  }
  return (
    <SetupStepBody
      key={step}
      step={step}
      userId={userId}
      companyId={facts.companyId}
      reviewCount={0}
    />
  );
}

function SetupStepBody({
  step,
  userId,
  companyId,
  reviewCount,
}: {
  step: SetupStepId;
  userId: string | null;
  companyId: string | null;
  reviewCount: number;
}) {
  const navigate = useNavigate();
  const goBack = useGoBack();
  const fromCard = useFromCard();
  const created = companyCreatedThisRun(userId);
  const dashboard = useDashboardQuery();
  const count = dashboard.data?.review_count ?? reviewCount;
  const backTo = backPath(step, fromCard, created);
  const [createdCompany, setCreatedCompany] = useState<string | null>(null);

  function go(path: string) {
    void navigate(path);
  }

  function skip() {
    if (step === 0 || !userId) return;
    const at = new Date().toISOString();
    const current = readSetupStore(userId, companyId);
    writeSetupStore(userId, companyId, skipPatch(current, step, at));
    const next = continuePath(step, fromCard);
    if (fromCard) goBack(next);
    else go(next);
  }

  function back() {
    if (backTo) goBack(backTo);
  }

  if (step === 0) {
    // FLOW-406: once the company exists, step 0 asks for the starter categories before step 1.
    const starterCompany = createdCompany ?? companyId;
    if (starterCompany != null) {
      return (
        <StepStarter
          initial={readSetupStore(userId, starterCompany).starter_set}
          onDone={(set) => {
            if (userId && set != null) {
              const current = readSetupStore(userId, starterCompany);
              writeSetupStore(userId, starterCompany, { ...current, starter_set: set, starter_at: new Date().toISOString() });
            }
            go("/setup/1");
          }}
        />
      );
    }
    return (
      <StepBusiness
        userId={userId}
        onDone={(nextCompany) => {
          if (userId) {
            const at = new Date().toISOString();
            const current = readSetupStore(userId, nextCompany);
            writeSetupStore(userId, nextCompany, { ...current, run_started_at: current.run_started_at ?? at });
          }
          setCreatedCompany(nextCompany);
        }}
      />
    );
  }
  if (step === 1) {
    return (
      <StepSumit
        onBack={backTo ? back : undefined}
        onSkip={skip}
        onConnected={() => {
          go(continuePath(1, fromCard));
        }}
      />
    );
  }
  if (step === 2) {
    return (
      <StepJev
        onBack={backTo ? back : undefined}
        onSkip={skip}
        onSaved={() => {
          go(continuePath(2, fromCard));
        }}
      />
    );
  }
  if (step === 3) {
    return (
      <StepLists
        onBack={backTo ? back : undefined}
        onSkip={skip}
        onConfirm={() => {
          if (userId) {
            const at = new Date().toISOString();
            const current = readSetupStore(userId, companyId);
            writeSetupStore(userId, companyId, confirmLists(current, at));
          }
          go(continuePath(3, fromCard));
        }}
      />
    );
  }
  if (step === 4) {
    return (
      <StepReview
        count={count}
        onBack={backTo ? back : undefined}
        onSkip={skip}
        onOpen={() => {
          const query = fromCard ? "?setup=1&from=card" : "?setup=1";
          go(`/review${query}`);
        }}
      />
    );
  }
  return (
    <StepInstall
      onBack={backTo ? back : undefined}
      onSkip={skip}
      onFinish={(kind) => {
        if (userId) {
          const at = new Date().toISOString();
          const current = readSetupStore(userId, companyId);
          writeSetupStore(userId, companyId, kind === "ios" ? finishIos(current, at) : finishInstall(current, at));
        }
        go(continuePath(5, fromCard));
      }}
    />
  );
}
