import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const LoansScreen = lazy(() => screenLoaders.loans().then((m) => ({ default: m.LoansScreen })));
const LoanDetailScreen = lazy(() => screenLoaders.loanDetail().then((m) => ({ default: m.LoanDetailScreen })));

/** The הלוואות tab (FLOW-139b): its list, and one loan's page with its details and future periods. */
export function LoanRoutes() {
  return (
    <>
      <Route path="loans" element={<LoansScreen />} />
      {/* FLOW-106 B / FLOW-110: one loan's page. */}
      <Route path="loans/:loanId" element={<LoanDetailScreen />} />
      <Route path="loans/:loanId/details" element={<LoanDetailScreen view="details" />} />
      <Route path="loans/:loanId/future" element={<LoanDetailScreen view="future" />} />
      <Route path="loans/:loanId/future/:period" element={<LoanDetailScreen view="period" />} />
    </>
  );
}
