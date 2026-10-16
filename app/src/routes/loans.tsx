import { lazy } from "react";
import { Navigate, Route, useLocation } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const LoansScreen = lazy(() => screenLoaders.loans().then((m) => ({ default: m.LoansScreen })));
const LoanDetailScreen = lazy(() => screenLoaders.loanDetail().then((m) => ({ default: m.LoanDetailScreen })));

/** The old `/settings/loans` pages live under `/loans` now. */
export function loansPathFor(pathname: string): string {
  return pathname.replace(/^\/settings\/loans/, "/loans");
}

function RedirectToLoans() {
  const location = useLocation();
  return <Navigate to={{ pathname: loansPathFor(location.pathname), search: location.search }} replace />;
}

/** The loans tab (FLOW-139): its list, and one loan's page with its details, future periods and all payments. */
export function LoanRoutes() {
  return (
    <>
      <Route path="loans" element={<LoansScreen />} />
      <Route path="loans/:loanId" element={<LoanDetailScreen />} />
      <Route path="loans/:loanId/details" element={<LoanDetailScreen view="details" />} />
      <Route path="loans/:loanId/future" element={<LoanDetailScreen view="future" />} />
      <Route path="loans/:loanId/future/:period" element={<LoanDetailScreen view="period" />} />
      <Route path="settings/loans" element={<RedirectToLoans />} />
      <Route path="settings/loans/*" element={<RedirectToLoans />} />
    </>
  );
}
