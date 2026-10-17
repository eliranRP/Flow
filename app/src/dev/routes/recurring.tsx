import { useSearchParams } from "react-router-dom";
import { RecurringChargeScreen } from "../../screens/recurring-charge-screen";
import { RecurringScreen } from "../../screens/recurring-screen";
import { RECURRING_CHARGES_FIXTURE_POWER, RECURRING_CHARGES_FIXTURE_WATER, RECURRING_FIXTURE, RECURRING_MISSING_FIXTURE } from "../../recurring-sample";
import type { DevRoute } from "./types";

/** The board fixture date: 11/10/2026 (the late days count from it). */
const CHARGE_NOW = new Date("2026-10-11T12:00:00Z");

/**
 * FLOW-447: the list on the rule-25 fixture, for the e2e run and the board proof. FLOW-447b:
 * `?preset=swipe` opens the late bill with a suggestion over its action, `?preset=ignored` has
 * that bill ignored (it is a grey row in its group), `?preset=error` shows the failed read.
 */
export function DevRecurring() {
  const [params] = useSearchParams();
  const preset = params.get("preset");
  const late = preset === "ignored" ? RECURRING_MISSING_FIXTURE.filter((bill) => bill.party_id !== "power") : RECURRING_MISSING_FIXTURE;
  return <RecurringScreen now={CHARGE_NOW} sample={RECURRING_FIXTURE} missing={late} failed={preset === "error"} openId={preset === "swipe" ? "power" : undefined} />;
}

/**
 * FLOW-447c: the charge page on the board's two parties. `item` is the water bill (arrived, 38% over),
 * `late` the power bill with its suggested match, `pace` the water bill with its pace sheet open, and
 * `ignored` the power bill with its late alert ignored.
 */
export function DevRecurringCharge() {
  const [params] = useSearchParams();
  const preset = params.get("preset");
  const power = RECURRING_CHARGES_FIXTURE_POWER;
  const water = RECURRING_CHARGES_FIXTURE_WATER;
  if (preset === "late") return <RecurringChargeScreen now={CHARGE_NOW} sample={power} />;
  if (preset === "ignored") return <RecurringChargeScreen now={CHARGE_NOW} sample={{ ...power, bills: RECURRING_MISSING_FIXTURE.filter((bill) => bill.party_id !== "power") }} />;
  if (preset === "pace") return <RecurringChargeScreen now={CHARGE_NOW} sample={water} openSheet="pace" />;
  return <RecurringChargeScreen now={CHARGE_NOW} sample={water} />;
}

export const recurringRoutes: DevRoute[] = [
  { path: "recurring", element: <DevRecurring /> },
  { path: "recurring-charge", element: <DevRecurringCharge /> },
];
