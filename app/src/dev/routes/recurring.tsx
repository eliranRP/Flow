import { useSearchParams } from "react-router-dom";
import { RecurringScreen } from "../../screens/recurring-screen";
import { RECURRING_FIXTURE, RECURRING_MISSING_FIXTURE } from "../../recurring-sample";
import type { DevRoute } from "./types";

/**
 * FLOW-447: the list on the rule-25 fixture, for the e2e run and the board proof. FLOW-447b:
 * `?preset=swipe` opens the late bill with a suggestion over its action, `?preset=ignored` has
 * that bill ignored (it is a grey row in its group), `?preset=error` shows the failed read.
 */
export function DevRecurring() {
  const [params] = useSearchParams();
  const preset = params.get("preset");
  const late = preset === "ignored" ? RECURRING_MISSING_FIXTURE.filter((bill) => bill.party_id !== "power") : RECURRING_MISSING_FIXTURE;
  return <RecurringScreen sample={RECURRING_FIXTURE} missing={late} failed={preset === "error"} openId={preset === "swipe" ? "power" : undefined} />;
}

export const recurringRoutes: DevRoute[] = [{ path: "recurring", element: <DevRecurring /> }];
