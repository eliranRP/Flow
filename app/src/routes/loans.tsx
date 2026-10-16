import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const LoansScreen = lazy(() => screenLoaders.settings().then((m) => ({ default: m.LoansScreen })));
const LoanDetailScreen = lazy(() => screenLoaders.loanDetail().then((m) => ({ default: m.LoanDetailScreen })));

/** Settings' loan list, and one loan's page with its details and future periods. */
export function LoanRoutes() {
  return (
    <>
      <Route path="settings/loans" element={<LoansScreen />} />
      {/* FLOW-106 B / FLOW-110: one loan's page. */}
      <Route path="settings/loans/:loanId" element={<LoanDetailScreen />} />
      <Route path="settings/loans/:loanId/details" element={<LoanDetailScreen view="details" />} />
      <Route path="settings/loans/:loanId/future" element={<LoanDetailScreen view="future" />} />
      <Route path="settings/loans/:loanId/future/:period" element={<LoanDetailScreen view="period" />} />
    </>
  );
}
