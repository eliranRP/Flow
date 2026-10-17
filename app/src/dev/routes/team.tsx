import { lazy } from "react";
import type { DevRoute } from "./types";

const devTeam = () => import("../team-fixtures");
const DevCompany = /* @__PURE__ */ lazy(() => devTeam().then((m) => ({ default: m.DevCompany })));
const DevInvites = /* @__PURE__ */ lazy(() => devTeam().then((m) => ({ default: m.DevInvites })));
const DevTeam = /* @__PURE__ */ lazy(() => devTeam().then((m) => ({ default: m.DevTeam })));

export const teamRoutes: DevRoute[] = [{ path: "team", element: <DevTeam /> }];
export const companyRoutes: DevRoute[] = [{ path: "company", element: <DevCompany /> }];
export const invitesRoutes: DevRoute[] = [{ path: "invites", element: <DevInvites /> }];
