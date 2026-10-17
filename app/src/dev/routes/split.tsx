import { lazy } from "react";
import type { DevRoute } from "./types";

const DevLineSplit = /* @__PURE__ */ lazy(() => import("../../dev/line-split-e2e").then((m) => ({ default: m.DevLineSplit })));

export const splitRoutes: DevRoute[] = [
  { path: "split-category", element: <DevLineSplit /> },
];
