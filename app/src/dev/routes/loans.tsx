import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LoanDetailScreen, type LoanView } from "../../screens/loan-detail-screen";
import { LoansScreen } from "../../screens/loans-screen";
import { useMemoryLoanStore } from "../../screens/loan-detail-store";
import { devLoanStore, resetDevLoanStore, SAMPLE_LOAN_PROJECTS } from "../loan-detail-sample";
import { LoanSummaryCard } from "../../screens/loan-summary-card";
import { LOAN_SUMMARY_SAMPLE } from "../loan-summary-sample";
import { useDevSettingsSample } from "./settings";
import type { DevRoute } from "./types";

/** FLOW-106 B: the list reads the dev loan store, so a status change or a delete on a loan's page shows here. `?loans=none` is empty, `?closed=1` opens the closed group. */
export function DevLoans() {
  const [params] = useSearchParams();
  const settings = useDevSettingsSample();
  const store = devLoanStore();
  useMemoryLoanStore(store);
  return (
    <LoansScreen
      closedOpen={params.get("closed") === "1"}
      sample={{
        noCompany: settings?.noCompany,
        loanProjects: SAMPLE_LOAN_PROJECTS,
        loans: params.get("loans") === "none" ? [] : store.rows(),
      }}
    />
  );
}

/** FLOW-106 B / FLOW-110: a loan's page on fake data. `?reset=1` starts the dev store over. */
export function DevLoanDetail({ view }: { view?: LoanView } = {}) {
  const [params] = useSearchParams();
  // StrictMode runs the initializer twice, so the page reads the current store, not the returned one.
  useState(() => (params.get("reset") === "1" ? resetDevLoanStore() : null));
  const store = devLoanStore();
  const preview = params.get("preview");
  return <LoanDetailScreen store={store} view={view} listPath={`/e2e/loans${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`} />;
}

/** FLOW-139. The loans list's summary card alone, for the board proof. */
export function DevLoanSummary() {
  return (
    <div className="ui-page-pad">
      <LoanSummaryCard summary={LOAN_SUMMARY_SAMPLE} currency="USD" />
    </div>
  );
}

export const loansRoutes: DevRoute[] = [
  { path: "loans", element: <DevLoans /> },
  { path: "loans-summary", element: <DevLoanSummary /> },
  { path: "loans/:loanId", element: <DevLoanDetail /> },
  { path: "loans/:loanId/details", element: <DevLoanDetail view="details" /> },
  { path: "loans/:loanId/future", element: <DevLoanDetail view="future" /> },
  { path: "loans/:loanId/future/:period", element: <DevLoanDetail view="period" /> },
];
