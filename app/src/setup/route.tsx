import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { usePreviewMode } from "../preview";
import { useSetupFacts } from "./facts";
import { decideEntry, withPatch } from "./model";
import { resetSetupServerForTests } from "./server-store";
import { useSetupStore } from "./store";
import { markSessionEntered, sessionEntered, writeSetupStore } from "./storage";
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
    if (decision.kind === "stay") return;
    if (decision.markSession) markSessionEntered(userId);
    if (decision.patch) writeSetupStore(userId, facts.companyId, withPatch(store, decision.patch));
    void navigate(decision.to);
  }, [pathname, preview, status, userId, viewer.ready, viewer.viewer, facts, store, storeReady, navigate]);
  return null;
}

