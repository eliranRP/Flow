import { useEffect, useLayoutEffect, useRef } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { usePreviewMode, usePreviewSearch } from "../preview";
import { useGoBack } from "../ui/back";
import { useDashboardQuery } from "../use-books";
import { useSetupFacts } from "./facts";
import {
  backPath,
  continuePath,
  decideEntry,
  finishInstall,
  finishIos,
  indexTarget,
  parseStep,
  resumeStamp,
  skipPatch,
  confirmLists,
  withPatch,
  type SetupStepId,
} from "./model";
import { StepBusiness, StepInstall, StepJev, StepLists, StepReview, StepSumit } from "./steps";
import { resetSetupServerForTests } from "./server-store";
import { useSetupStore } from "./store";
import {
  companyCreatedThisRun,
  markSessionEntered,
  readSetupStore,
  sessionEntered,
  writeSetupStore,
} from "./storage";
import { useSetupViewer } from "./viewer";

/** First route on load. Survives Shell remounts after full-screen routes. */
let landingPath: string | null = null;
/** The user whose one resume this page load already considered. A sign-in as another user gets its own. */
let resumeConsideredFor: string | null = null;

/** Tests reset landing capture between cases. */
export function resetSetupResumeForTests(): void {
  landingPath = null;
  resumeConsideredFor = null;
  resetSetupServerForTests();
}

const AUTH_ENTRY = new Set(["/sign-in", "/auth/callback"]);

/** Records the first app route once. Mounted for every route, so a full-screen deep link counts. */
export function noteSetupLanding(pathname: string): void {
  if (landingPath === null && !AUTH_ENTRY.has(pathname)) landingPath = pathname;
}

export function SetupLanding(): null {
  const { pathname } = useLocation();
  // A layout effect, not render: a render React throws away must not record the landing.
  useLayoutEffect(() => { noteSetupLanding(pathname); }, [pathname]);
  return null;
}

function useFromCard(): boolean {
  const [params] = useSearchParams();
  return params.get("from") === "card";
}

export function SetupResume() {
  const preview = usePreviewMode();
  const { pathname } = useLocation();
  useLayoutEffect(() => { noteSetupLanding(pathname); }, [pathname]);
  const home = pathname === "/";
  const { status, session } = useAuth();
  const userId = session?.user.id ?? null;
  const viewer = useSetupViewer();
  // Home is the only launch surface. A cold /review must not call get_dashboard or leave the card.
  const facts = useSetupFacts(home && !preview && status === "authed" && viewer.ready && !viewer.viewer);
  const { store, ready: storeReady } = useSetupStore(userId, facts.companyId);
  const navigate = useNavigate();
  const acted = useRef("");
  useEffect(() => {
    // Read here, after the layout effects recorded the landing.
    const resumeAtLandingHome = landingPath === "/" && pathname === "/" && resumeConsideredFor !== userId;
    if (!resumeAtLandingHome || preview || status !== "authed" || !userId || !viewer.ready || viewer.viewer || !facts.ready || !storeReady) return;
    const signature = `${facts.companyId ?? ""}:${store.run_started_at ?? ""}:${store.run_resumed_at ?? ""}:${store.card_dismissed_at ?? ""}`;
    if (acted.current === signature) return;
    const at = new Date().toISOString();
    const entered = sessionEntered(userId);
    const decision = decideEntry(store, facts, entered, at);
    if (decision.kind === "wait") return;
    resumeConsideredFor = userId;
    acted.current = signature;
    if (decision.kind === "stay") {
      const stamp = resumeStamp(store, facts, entered, at);
      if (stamp) writeSetupStore(userId, facts.companyId, withPatch(store, stamp));
      return;
    }
    if (decision.markSession) markSessionEntered(userId);
    if (decision.patch) writeSetupStore(userId, facts.companyId, withPatch(store, decision.patch));
    void navigate(decision.to);
  }, [pathname, preview, status, userId, viewer.ready, viewer.viewer, facts, store, storeReady, navigate]);
  return null;
}

export function SetupIndex() {
  const preview = usePreviewMode();
  const search = usePreviewSearch();
  const { status, session } = useAuth();
  const facts = useSetupFacts(!preview && status === "authed");
  const { store } = useSetupStore(session?.user.id ?? null, facts.companyId);
  if (preview) return <Navigate to={`/${search}`} replace />;
  if (status === "loading" || !facts.ready) return null;
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
  const { store } = useSetupStore(userId, facts.companyId);
  if (preview) return <Navigate to={`/${search}`} replace />;
  if (step == null) return <Navigate to="/setup" replace />;
  if (!viewer.ready || status === "loading") return null;
  if (viewer.viewer) return <Navigate to={`/${search}`} replace />;
  if (!facts.ready) return null;
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
    return (
      <StepBusiness
        userId={userId}
        onDone={(nextCompany) => {
          if (userId) {
            const at = new Date().toISOString();
            const current = readSetupStore(userId, nextCompany);
            writeSetupStore(userId, nextCompany, { ...current, run_started_at: current.run_started_at ?? at });
          }
          go("/setup/1");
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
