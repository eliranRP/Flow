import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { coldOpenRoute, type ColdOpenRoute } from "./cold-open-route";
import { CashHomeSkeleton } from "./screens/home-skeleton";
import { FormSkeleton, GroupedSkeleton } from "./ui/loading-shapes";
import { ScreenHeader } from "./ui/screen-header";
import { DetailSkeleton, LinesSkeleton, LoansSkeleton, ProfitSkeleton, ProjectsSkeleton, RecurringSkeleton } from "./ui/screen-skeletons";
import { DelayedSkeleton, ListSkeleton, Skeleton } from "./ui/skeleton";
import { TabBar } from "./ui/tab-bar";
import { TopBand } from "./ui/top-band";

/**
 * FLOW-1140: a route's loading frame (cold-open-route.ts). The bar or band shows on the first frame,
 * as the screen draws it while it loads; the grey blocks wait 300ms like every skeleton, so a fast
 * load shows nothing under the bar.
 */

/** Back's place, not a live Back: nothing to go back to before the session is in. */
const lead = <span className="ui-skel-lead" aria-hidden="true" />;

function Bar({ route }: { route: ColdOpenRoute }) {
  if (route.bar === "plain" && route.title != null) return <ScreenHeader title={route.title} />;
  if (route.bar === "back") {
    return route.title == null
      ? <ScreenHeader barOnly leading={lead} />
      : <ScreenHeader layout="stacked" className="ui-state-header" leading={lead} title={route.title} />;
  }
  return null;
}

function Band({ route, children }: { route: ColdOpenRoute; children: ReactNode }) {
  const loans = route.shape === "loans";
  const title = route.title == null
    ? <DelayedSkeleton><Skeleton tone="band" className="ui-skel-project-label" /></DelayedSkeleton>
    : <h1 className={loans ? "ui-loans-band-title t-sheet" : "t-title ui-projects-band-title"}>{route.title}</h1>;
  const hero = (
    <DelayedSkeleton>
      <div className={loans ? "ui-loans-band-skel" : "ui-project-skel"} aria-hidden="true">
        <Skeleton tone="band" className={loans ? undefined : "ui-skel-project-label"} width="md" />
        <Skeleton tone="band" className="ui-skel-project-num" />
      </div>
    </DelayedSkeleton>
  );
  return (
    <div className={loans ? "ui-loans-screen" : "ui-projects-page flex min-h-full flex-1 flex-col"} aria-busy="true">
      <TopBand wordmark={false} leading={title} hero={hero} heroClassName={loans ? undefined : "ui-band-hero-project"} />
      <div className={loans ? "ui-loans-body" : undefined}>{children}</div>
    </div>
  );
}

function Blocks({ route }: { route: ColdOpenRoute }) {
  switch (route.shape) {
    case "projects":
      return <ProjectsSkeleton />;
    case "loans":
      return <LoansSkeleton />;
    case "settings":
      return <GroupedSkeleton groups={route.title == null ? [3, 2] : [4, 3]} />;
    case "recurring":
      return <RecurringSkeleton />;
    case "profit":
      return <ProfitSkeleton />;
    case "lines":
      return <LinesSkeleton />;
    case "detail":
      return <DetailSkeleton />;
    case "form":
      return <FormSkeleton figure fields={3} />;
    default:
      return <ListSkeleton />;
  }
}

/** The loading frame's body, inside the route's own outlet (the full-screen fallback draws only this). */
export function RouteLoadingBody({ route, wait = true }: { route: ColdOpenRoute; /** False when the caller already waited 300ms. */ wait?: boolean }) {
  if (route.shape === "home") return <CashHomeSkeleton />;
  const blocks = wait ? <DelayedSkeleton><Blocks route={route} /></DelayedSkeleton> : <Blocks route={route} />;
  if (route.bar === "band") return <Band route={route}>{blocks}</Band>;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-busy="true">
      <Bar route={route} />
      {blocks}
    </div>
  );
}

/** RequireAuth while the session loads: the route's frame in the outlet it lands in, the tab bar under a tab route. */
export function ColdOpenSkeleton() {
  const route = coldOpenRoute(useLocation().pathname);
  if (route.layout === "full") {
    return (
      <div className="safe-bottom min-h-dvh">
        <RouteLoadingBody route={route} />
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="below-tabbar flex min-h-0 min-w-0 flex-1 flex-col">
        <RouteLoadingBody route={route} />
      </div>
      <TabBar />
    </div>
  );
}

/** FullScreen's fallback while a screen's code loads: its bar and blocks after 300ms, so a fast load shows nothing. */
export function FullScreenFallback() {
  const route = coldOpenRoute(useLocation().pathname);
  return (
    <DelayedSkeleton>
      <RouteLoadingBody route={route} wait={false} />
    </DelayedSkeleton>
  );
}
