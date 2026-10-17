import { Fragment } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import { TabBar, type TabSection } from "../../ui/tab-bar";
import { devRouteGroups } from "./index";

/** Dev only: the /e2e/ fixtures under /e2e/*, each group under the shell it draws (none: no tab bar). */
export function DevRoutes() {
  return (
    <Routes>
      {devRouteGroups.map((group, index) => {
        const routes = group.routes.map((route) => <Route key={route.path} path={route.path} element={route.element} />);
        if (group.section === "none") return <Fragment key={index}>{routes}</Fragment>;
        return (
          <Route key={index} element={<DevShell section={group.section} />}>
            {routes}
          </Route>
        );
      })}
    </Routes>
  );
}

/** The fixture modules the e2e sweeps need loaded before they look (App.tsx sets the screensLoaded mark after this). */
export function preloadDevFixtures(): Promise<unknown> {
  return Promise.all([
    import("../line-split-e2e"),
    import("../../screens/jev-review-card"),
    import("../team-fixtures"),
  ]);
}

/** Dev only (FLOW-334): the Shell's tab bar for an /e2e/ fixture, on the tab its real screen belongs to. */
function DevShell({ section }: { section: TabSection | null }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="below-tabbar flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
      <TabBar section={section} />
    </div>
  );
}
