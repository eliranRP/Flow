import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const LoansScreen = lazy(() => screenLoaders.loans().then((m) => ({ default: m.LoansScreen })));
const LoanDetailScreen = lazy(() => screenLoaders.loanDetail().then((m) => ({ default: m.LoanDetailScreen })));

/** The הלוואות tab (FLOW-139b): its list, one loan's page (FLOW-139c), and that loan's all-payments page. */
export function LoanRoutes() {
  return (
    <>
      <Route path="loans" element={<LoansScreen />} />
      {/* FLOW-106 B / FLOW-110: one loan's page. */}
      <Route path="loans/:loanId" element={<LoanDetailScreen />} />
      <Route path="loans/:loanId/payments" element={<LoanDetailScreen view="payments" />} />
    </>
  );
}
