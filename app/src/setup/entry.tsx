import { useEffect, useLayoutEffect, useState, type ComponentType } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { usePreviewMode } from "../preview";
import { useDashboardQuery } from "../use-books";
import { useSetupMayResume } from "./gate";
import { noteSetupLanding, setupLandingPath } from "./landing";
import { useSetupViewer } from "./viewer";

export { SetupLanding } from "./landing";

/**
 * FLOW-1342. The setup screens' code (on-demand.tsx: route.tsx and what it shares) is not in Home's first
 * load. These are the parts that stay in it: they decide from the saved flags whether setup matters to
 * this user, and only then load the rest. Every one draws nothing, before and after the load, so Home
 * does not move. A failed load is retried twice (1.5 s, then 4 s later), silent, never the app's error
 * screen; after the last a missed resume is what an offline cold start had.
 */

const loadResume = () => import("./on-demand").then((m) => m.SetupResume);

/** After a failed load, wait this long and try again; it gives up after the last. */
const RETRY_MS = [1500, 4000];

/** The component once `wanted` is true and its module has loaded; null until then. */
function useOnDemand<P>(load: () => Promise<ComponentType<P>>, wanted: boolean): ComponentType<P> | null {
  const [loaded, setLoaded] = useState<ComponentType<P> | null>(null);
  useEffect(() => {
    if (!wanted || loaded != null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      load().then(
        (component) => { if (live) setLoaded(() => component); },
        () => { if (live && n < RETRY_MS.length) timer = setTimeout(() => { attempt(n + 1); }, RETRY_MS[n]); },
      );
    };
    attempt(0);
    return () => { live = false; clearTimeout(timer); };
  }, [wanted, loaded, load]);
  return loaded;
}

/**
 * The resume redirect, from Home as the landing. The chunk loads when this user may be redirected: a
 * signed-in owner with no company yet (the welcome screen), or a run the flow started and left open.
 * Anyone else is never redirected, so they never load it.
 */
export function SetupResume() {
  const preview = usePreviewMode();
  const { pathname } = useLocation();
  useLayoutEffect(() => { noteSetupLanding(pathname); }, [pathname]);
  const { status, session } = useAuth();
  const userId = session?.user.id ?? null;
  const viewer = useSetupViewer();
  // Until the landing is recorded (this render runs before the layout effects), Home counts as it.
  const atLandingHome = pathname === "/" && (setupLandingPath() ?? pathname) === "/";
  const launch = atLandingHome && !preview && status === "authed" && viewer.ready && !viewer.viewer;
  const dashboard = useDashboardQuery(launch);
  const answered = dashboard.data != null;
  const companyId = dashboard.data?.company_id ?? null;
  const mayResume = useSetupMayResume(userId, companyId, launch && answered);
  const Loaded = useOnDemand(loadResume, mayResume || (launch && answered && companyId == null));
  return Loaded ? <Loaded /> : null;
}
