import type { ReactElement } from "react";
import type { TabSection } from "../../ui/tab-bar";

export type DevRoute = { path: string; element: ReactElement };
/** `"none"` is a route with no DevShell wrapper: no tab bar. */
export type DevRouteGroup = { section: TabSection | null | "none"; routes: DevRoute[] };
