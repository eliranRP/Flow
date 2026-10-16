import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const UnpaidScreen = lazy(() => screenLoaders.unpaid().then((m) => ({ default: m.UnpaidScreen })));

/** Open invoices: the bills that are not paid yet. */
export function UnpaidRoute() {
  return <Route path="unpaid" element={<UnpaidScreen />} />;
}
