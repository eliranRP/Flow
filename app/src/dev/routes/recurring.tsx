import { RecurringScreen } from "../../screens/recurring-screen";
import { RECURRING_FIXTURE } from "../../recurring-sample";
import type { DevRoute } from "./types";

/** FLOW-447: the list on the rule-25 fixture, for the e2e run. */
export function DevRecurring() {
  return <RecurringScreen sample={RECURRING_FIXTURE} />;
}

export const recurringRoutes: DevRoute[] = [{ path: "recurring", element: <DevRecurring /> }];
