import type { DevRouteGroup } from "./types";
import { homeRoutes } from "./home";
import { reviewRoutes } from "./review";
import { invoicesRoutes } from "./invoices";
import { recurringRoutes } from "./recurring";
import { forecastRoutes } from "./forecast";
import { projectRoutes, projectsRoutes } from "./projects";
import { profitRoutes } from "./profit";
import { loansRoutes } from "./loans";
import { settingsRoutes } from "./settings";
import { transactionRoutes } from "./transaction";
import { splitRoutes } from "./split";
import { setupRoutes, installRoutes } from "./onboarding";
import { companyRoutes, invitesRoutes, teamRoutes } from "./team";

/** The /e2e/ fixtures (paths under /e2e/), by the shell each one draws. Empty outside the dev server. */
export const devRouteGroups: DevRouteGroup[] = import.meta.env.DEV
  ? [
      { section: "none", routes: [...setupRoutes, ...projectRoutes] },
      { section: "home", routes: reviewRoutes },
      { section: "home", routes: [...homeRoutes, ...invoicesRoutes, ...forecastRoutes] },
      { section: "recurring", routes: recurringRoutes },
      { section: "projects", routes: [...projectsRoutes, ...profitRoutes] },
      { section: "loans", routes: loansRoutes },
      { section: "home", routes: settingsRoutes },
      { section: "home", routes: [...companyRoutes, ...transactionRoutes] },
      { section: "none", routes: [...teamRoutes, ...invitesRoutes, ...installRoutes, ...splitRoutes] },
    ]
  : [];
